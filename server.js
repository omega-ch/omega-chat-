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

// --- CHARGEMENT DES CONFIGURATIONS ---
let QWEN_KEY = '';
let GEMINI_KEY = '';
let SYSTEM_PROMPT = 'Tu es Oméga, un assistant IA avancé capable de recherche web et de génération de code.';

// Charger Qwen (api.txt)
try {
    QWEN_KEY = fs.readFileSync(path.join(__dirname, 'api.txt'), 'utf8').trim();
} catch (e) {
    console.warn('api.txt non trouvé ou vide');
}

// Charger Gemini (r.txt)
try {
    GEMINI_KEY = fs.readFileSync(path.join(__dirname, 'r.txt'), 'utf8').trim();
} catch (e) {
    console.warn('r.txt non trouvé ou vide');
}

// Charger le system prompt commun (config.txt)
try {
    SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'config.txt'), 'utf8').trim();
} catch (e) {
    console.warn('config.txt non trouvé, utilisation du prompt par défaut');
}

// Stockage des sessions
const sessionHistories = {};

app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- ROUTE PRINCIPALE DU CHAT ---
app.post('/api/chat', upload.single('file'), async (req, res) => {
    const { message, sessionId, version, enableSearch } = req.body;
    const file = req.file;

    if (!sessionId) return res.status(400).json({ error: 'Session ID requis' });
    if (!sessionHistories[sessionId]) sessionHistories[sessionId] = [];

    try {
        // 1. Traitement du fichier/image
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
                currentTurnParts.push({ type: "text", text: `Contenu de ${file.originalname}:\n${textContent}` });
            }
        }

        if (currentTurnParts.length === 0) return res.status(400).json({ error: 'Message ou fichier requis' });

        sessionHistories[sessionId].push({ role: 'user', content: currentTurnParts });
        if (sessionHistories[sessionId].length > 20) {
            sessionHistories[sessionId] = sessionHistories[sessionId].slice(-20);
        }

        let aiResponse = '';

        // 2. Routage vers la bonne version
        if (version === '1.0') {
            if (!GEMINI_KEY) throw new Error('Clé Gemini (r.txt) manquante');
            aiResponse = await callGeminiAPI(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch);
        } else {
            if (!QWEN_KEY) throw new Error('Clé Qwen (api.txt) manquante');
            aiResponse = await callQwenAPI(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch);
        }

        sessionHistories[sessionId].push({ role: 'assistant', content: aiResponse });
        res.json({ response: aiResponse });

    } catch (error) {
        console.error('Erreur API:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Erreur IA', 
            details: error.response?.data?.message || error.message 
        });
    }
});

// --- FONCTIONS D'APPEL API ---

async function callQwenAPI(history, systemPrompt, enableSearch) {
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

    const payload = {
        model: 'qwen-vl-max',
        messages,
        temperature: 0.7,
        max_tokens: 8000,
    };

    if (enableSearch) {
        payload.enable_search = true;
    }

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

async function callGeminiAPI(history, systemPrompt, enableSearch) {
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
        contents: contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            maxOutputTokens: 8000,
            temperature: 0.7
        }
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

app.listen(PORT, () => console.log(`Serveur Oméga démarré sur le port ${PORT}`));
