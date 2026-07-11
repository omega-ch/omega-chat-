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

try { QWEN_KEY = fs.readFileSync(path.join(__dirname, 'api.txt'), 'utf8').trim(); } catch (e) {}
try { GEMINI_KEY = fs.readFileSync(path.join(__dirname, 'r.txt'), 'utf8').trim(); } catch (e) {}
try { SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'config.txt'), 'utf8').trim(); } catch (e) {}

const sessionHistories = {};

app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- PARSER SSE SIMPLE ---
function parseSSE(buffer) {
    const text = buffer.toString('utf8');
    const lines = text.split('\n');
    const events = [];
    let currentData = '';
    
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            currentData += line.slice(6);
        } else if (line === '' && currentData) {
            events.push(currentData.trim());
            currentData = '';
        }
    }
    if (currentData) events.push(currentData.trim());
    
    return events;
}

// --- ROUTE STREAMING ---
app.post('/api/chat', upload.single('file'), async (req, res) => {
    const { message, sessionId, version, enableSearch } = req.body;
    const file = req.file;

    if (!sessionId) return res.status(400).json({ error: 'Session ID requis' });
    if (!sessionHistories[sessionId]) sessionHistories[sessionId] = [];

    // Headers SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendChunk = (text) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    };

    const sendDone = (fullText) => {
        res.write(`data: ${JSON.stringify({ type: 'done', text: fullText })}\n\n`);
        res.end();
    };

    const sendError = (err) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || err })}\n\n`);
        res.end();
    };

    try {
        // Traitement du fichier
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

        if (currentTurnParts.length === 0) {
            sendError('Message ou fichier requis');
            return;
        }

        sessionHistories[sessionId].push({ role: 'user', content: currentTurnParts });
        if (sessionHistories[sessionId].length > 20) {
            sessionHistories[sessionId] = sessionHistories[sessionId].slice(-20);
        }

        let fullResponse = '';

        if (version === '1.0') {
            if (!GEMINI_KEY) throw new Error('Clé Gemini (r.txt) manquante');
            fullResponse = await streamGemini(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch, sendChunk);
        } else {
            if (!QWEN_KEY) throw new Error('Clé Qwen (api.txt) manquante');
            fullResponse = await streamQwen(sessionHistories[sessionId], SYSTEM_PROMPT, enableSearch, sendChunk);
        }

        sessionHistories[sessionId].push({ role: 'assistant', content: fullResponse });
        sendDone(fullResponse);

    } catch (error) {
        console.error('Erreur:', error.response?.data || error.message);
        sendError(error);
    }
});

// --- STREAMING QWEN ---
async function streamQwen(history, systemPrompt, enableSearch, onChunk) {
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
        stream: true,
        stream_options: { include_usage: false }
    };

    if (enableSearch) payload.enable_search = true;

    const response = await axios.post(
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
        payload,
        {
            headers: { 'Authorization': `Bearer ${QWEN_KEY}`, 'Content-Type': 'application/json' },
            responseType: 'stream',
            timeout: 120000
        }
    );

    return new Promise((resolve, reject) => {
        let fullText = '';
        let buffer = '';

        response.data.on('data', (chunk) => {
            buffer += chunk.toString();
            const events = parseSSE(buffer);
            
            for (const event of events) {
                if (event === '[DONE]') {
                    resolve(fullText);
                    return;
                }
                try {
                    const data = JSON.parse(event);
                    if (data.choices && data.choices[0]?.delta?.content) {
                        const text = data.choices[0].delta.content;
                        fullText += text;
                        onChunk(text);
                    }
                } catch (e) {}
            }
            buffer = '';
        });

        response.data.on('end', () => resolve(fullText));
        response.data.on('error', reject);
    });
}

// --- STREAMING GEMINI ---
async function streamGemini(history, systemPrompt, enableSearch, onChunk) {
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
    
    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout: 120000
    });

    return new Promise((resolve, reject) => {
        let fullText = '';
        let buffer = '';

        response.data.on('data', (chunk) => {
            buffer += chunk.toString();
            const events = parseSSE(buffer);
            
            for (const event of events) {
                if (event === '[DONE]') {
                    resolve(fullText);
                    return;
                }
                try {
                    const data = JSON.parse(event);
                    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                        const text = data.candidates[0].content.parts[0].text;
                        fullText += text;
                        onChunk(text);
                    }
                } catch (e) {}
            }
            buffer = '';
        });

        response.data.on('end', () => resolve(fullText));
        response.data.on('error', reject);
    });
}

app.listen(PORT, () => console.log(`Oméga démarré sur le port ${PORT}`));
