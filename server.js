const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ===== CLÉS API INTÉGRÉES =====
// Remplacez ces valeurs par vos vraies clés API
const QWEN_KEY = 'sk-ws-H.XMPLHM.4mFo.MEQCIEUJg2XzJR0vVFzOdCRVBcJZ3Yt82xowwCoiX0hroWzdAiAlRIhNV9TORHzK9XfP-3JRIXVH3PfeYiseg2Qx2hhWug';
const GEMINI_KEY = 'AQ.Ab8RN6Jr3Z1kb1PIzE9A4QnOkl8Pyfnf6nPze5opd8vhKO3s0A';

// System prompt
const SYSTEM_PROMPT = 'Tu es Oméga, un assistant IA avancé capable de recherche web et de génération de code. Quand tu génères du code, assure-toi qu\'il soit complet, fonctionnel, bien commenté et suivant les bonnes pratiques.';

const sessionHistories = {};

app.get('/health', (req, res) => {
    res.status(200).send('OK - Serveur actif');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route chat
app.post('/api/chat', upload.single('file'), async (req, res) => {
    const { message, sessionId, version, enableSearch } = req.body;
    const file = req.file;

    console.log('Requête reçue:', { sessionId, version, message: message?.substring(0, 50) });

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID requis' });
    }

    if (!sessionHistories[sessionId]) {
        sessionHistories[sessionId] = [];
    }

    try {
        // Traitement fichier
        let currentTurnParts = [];
        if (message) currentTurnParts.push({ type: "text", text: message });

        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            const base64Data = fileBuffer.toString('base64');
            fs.unlinkSync(file.path);

            if (file.mimetype.startsWith('image/')) {
                currentTurnParts.push({
                    type: "image_url",
                    image_url: { url: `data:${file.mimetype};base64,${base64Data}` },
                    mime: file.mimetype,
                    base64: base64Data
                });
            } else {
                const textContent = fileBuffer.length < 50000 ? fileBuffer.toString('utf-8') : '[Fichier trop volumineux]';
                currentTurnParts.push({ type: "text", text: `Fichier ${file.originalname}:\n${textContent}` });
            }
        }

        if (currentTurnParts.length === 0) {
            return res.status(400).json({ error: 'Message requis' });
        }

        sessionHistories[sessionId].push({ role: 'user', content: currentTurnParts });
        if (sessionHistories[sessionId].length > 20) {
            sessionHistories[sessionId] = sessionHistories[sessionId].slice(-20);
        }

        let aiResponse = '';

        if (version === '1.0') {
            // GEMINI
            if (!GEMINI_KEY || GEMINI_KEY === 'VOTRE_CLE_GEMINI_ICI') {
                throw new Error('Clé Gemini non configurée dans le code');
            }
            aiResponse = await callGemini(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch);
        } else {
            // QWEN
            if (!QWEN_KEY) {
                throw new Error('Clé Qwen non configurée dans le code');
            }
            aiResponse = await callQwen(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch);
        }

        sessionHistories[sessionId].push({ role: 'assistant', content: aiResponse });
        
        console.log('Réponse envoyée avec succès');
        res.json({ response: aiResponse });

    } catch (error) {
        console.error('ERREUR:', error.message);
        console.error(error.response?.data || error);
        res.status(500).json({ 
            error: error.message || 'Erreur serveur',
            details: error.response?.data?.message || error.toString()
        });
    }
});

async function callQwen(history, systemPrompt, enableSearch) {
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : msg.content.map(p => {
                if (p.type === 'text') return { type: 'text', text: p.text };
                if (p.type === 'image_url') return { type: 'image_url', image_url: { url: p.image_url.url } };
            })
        }))
    ];

    const response = await axios.post(
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
            model: 'qwen-vl-max',
            messages,
            temperature: 0.7,
            max_tokens: 8000,
            ...(enableSearch && { enable_search: true })
        },
        {
            headers: { 
                'Authorization': `Bearer ${QWEN_KEY}`, 
                'Content-Type': 'application/json' 
            },
            timeout: 60000
        }
    );
    
    return response.data.choices[0].message.content;
}

async function callGemini(history, systemPrompt, enableSearch) {
    const contents = history.map(msg => {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let parts = [];
        
        if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
        } else {
            for (const p of msg.content) {
                if (p.type === 'text') parts.push({ text: p.text });
                if (p.type === 'image_url' && p.base64) {
                    parts.push({ inline_data: { mime_type: p.mime || 'image/jpeg', data: p.base64 } });
                }
            }
        }
        return { role, parts };
    });

    const payload = {
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 8000, temperature: 0.7 }
    };

    if (enableSearch) {
        payload.tools = [{
            google_search_retrieval: {
                dynamic_retrieval_config: { mode: "MODE_DYNAMIC", dynamic_threshold: 0.3 }
            }
        }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    
    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
    });
    
    return response.data.candidates[0].content.parts[0].text;
}

app.listen(PORT, () => {
    console.log(`✅ Serveur Oméga démarré sur le port ${PORT}`);
    console.log(`📡 Santé: http://localhost:${PORT}/health`);
    console.log(`🔑 Clé Qwen: ${QWEN_KEY ? '✓ Configurée' : '✗ Manquante'}`);
    console.log(`🔑 Clé Gemini: ${GEMINI_KEY && GEMINI_KEY !== 'VOTRE_CLE_GEMINI_ICI' ? '✓ Configurée' : '✗ Manquante'}`);
});
