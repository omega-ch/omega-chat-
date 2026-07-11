const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration multer
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

// ===== CLÉS API =====
const QWEN_KEY = 'sk-ws-H.XMPLHM.4mFo.MEQCIEUJg2XzJR0vVFzOdCRVBcJZ3Yt82xowwCoiX0hroWzdAiAlRIhNV9TORHzK9XfP-3JRIXVH3PfeYiseg2Qx2hhWug';
const GEMINI_KEY = 'VOTRE_CLE_GEMINI_ICI'; // Remplacez par votre clé

const SYSTEM_PROMPT = 'Tu es Oméga, un assistant IA avancé.';
const sessionHistories = {};

// Routes
app.get('/health', (req, res) => {
    res.status(200).send('OK - Serveur actif');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route chat PRINCIPALE
app.post('/api/chat', upload.single('file'), async (req, res) => {
    console.log('=== NOUVELLE REQUÊTE ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('File:', req.file);
    
    const { message, sessionId, version, enableSearch } = req.body;
    const file = req.file;

    // Validation
    if (!sessionId) {
        console.error(' Session ID manquant');
        return res.status(400).json({ error: 'Session ID requis' });
    }

    if (!message && !file) {
        console.error(' Message et fichier vides');
        return res.status(400).json({ error: 'Message ou fichier requis' });
    }

    console.log('✅ Données reçues:', {
        sessionId: sessionId.substring(0, 20) + '...',
        message: message ? message.substring(0, 50) + '...' : 'null',
        version,
        enableSearch,
        hasFile: !!file
    });

    // Init session
    if (!sessionHistories[sessionId]) {
        sessionHistories[sessionId] = [];
    }

    try {
        // Préparation du contenu
        let currentTurnParts = [];
        
        if (message && message.trim()) {
            currentTurnParts.push({ type: "text", text: message.trim() });
        }

        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            const base64Data = fileBuffer.toString('base64');
            fs.unlinkSync(file.path); // Supprime le fichier temporaire

            if (file.mimetype.startsWith('image/')) {
                currentTurnParts.push({
                    type: "image_url",
                    image_url: { url: `data:${file.mimetype};base64,${base64Data}` },
                    mime: file.mimetype,
                    base64: base64Data
                });
                console.log('✅ Image traitée');
            } else {
                const textContent = fileBuffer.length < 50000 
                    ? fileBuffer.toString('utf-8') 
                    : '[Fichier trop volumineux]';
                currentTurnParts.push({ 
                    type: "text", 
                    text: `Fichier ${file.originalname}:\n${textContent}` 
                });
                console.log('✅ Fichier texte traité');
            }
        }

        if (currentTurnParts.length === 0) {
            throw new Error('Aucun contenu valide');
        }

        // Ajout à l'historique
        sessionHistories[sessionId].push({ 
            role: 'user', 
            content: currentTurnParts 
        });
        
        // Limite historique
        if (sessionHistories[sessionId].length > 20) {
            sessionHistories[sessionId] = sessionHistories[sessionId].slice(-20);
        }

        console.log(`📡 Appel API ${version === '1.0' ? 'Gemini' : 'Qwen'}...`);

        let aiResponse = '';

        if (version === '1.0') {
            if (!GEMINI_KEY || GEMINI_KEY === 'VOTRE_CLE_GEMINI_ICI') {
                throw new Error('Clé Gemini non configurée');
            }
            aiResponse = await callGemini(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch === 'true');
        } else {
            if (!QWEN_KEY) {
                throw new Error('Clé Qwen non configurée');
            }
            aiResponse = await callQwen(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch === 'true');
        }

        console.log('✅ Réponse IA reçue:', aiResponse.substring(0, 100) + '...');

        // Sauvegarde réponse
        sessionHistories[sessionId].push({ 
            role: 'assistant', 
            content: aiResponse 
        });

        res.json({ response: aiResponse });

    } catch (error) {
        console.error('❌ ERREUR:', error.message);
        if (error.response) {
            console.error('Détails API:', error.response.data);
        }
        
        res.status(500).json({ 
            error: error.message || 'Erreur serveur',
            details: error.response?.data?.message || error.toString()
        });
    }
});

// Fonction appel Qwen
async function callQwen(history, systemPrompt, enableSearch) {
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' 
                ? msg.content 
                : msg.content.map(p => {
                    if (p.type === 'text') return { type: 'text', text: p.text };
                    if (p.type === 'image_url') return { type: 'image_url', image_url: { url: p.image_url.url } };
                })
        }))
    ];

    const payload = {
        model: 'qwen-vl-max',
        messages,
        temperature: 0.7,
        max_tokens: 8000
    };

    if (enableSearch) payload.enable_search = true;

    const response = await axios.post(
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
        payload,
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

// Fonction appel Gemini
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
                    parts.push({ 
                        inline_data: { 
                            mime_type: p.mime || 'image/jpeg', 
                            data: p.base64 
                        } 
                    });
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
                dynamic_retrieval_config: { 
                    mode: "MODE_DYNAMIC", 
                    dynamic_threshold: 0.3 
                }
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

// Démarrage serveur
app.listen(PORT, () => {
    console.log('\n🚀 SERVEUR OMÉGA DÉMARRÉ');
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔑 Qwen: ${QWEN_KEY ? '✓' : '✗'}`);
    console.log(`🔑 Gemini: ${GEMINI_KEY !== 'VOTRE_CLE_GEMINI_ICI' ? '✓' : '✗'}`);
    console.log(` Health: http://localhost:${PORT}/health\n`);
});
