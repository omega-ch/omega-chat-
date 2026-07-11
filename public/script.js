const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');
const loading = document.getElementById('loading');
const fileInput = document.getElementById('file-input');
const versionSelect = document.getElementById('version-select');
const searchToggle = document.getElementById('search-toggle');
const chatTitle = document.getElementById('chat-title');
const modelName = document.querySelector('.model-name');
const themeToggle = document.getElementById('theme-toggle');
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menu-btn');
const closeSidebar = document.getElementById('close-sidebar');
const newChatBtn = document.getElementById('new-chat-btn');
const conversationsList = document.getElementById('conversations-list');
const clearChatBtn = document.getElementById('clear-chat-btn');
const filePreview = document.getElementById('file-preview');
const filePreviewName = document.getElementById('file-preview-name');
const removeFileBtn = document.getElementById('remove-file');

marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
        return hljs.highlightAuto(code).value;
    },
    breaks: true, gfm: true
});

let conversations = JSON.parse(localStorage.getItem('omega_conversations') || '{}');
let currentConvId = localStorage.getItem('omega_current_conv') || null;
let selectedFile = null;
let isStreaming = false;

function generateId() { return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

function createNewConversation() {
    const id = generateId();
    conversations[id] = { id, title: 'Nouvelle conversation', messages: [], createdAt: Date.now() };
    currentConvId = id;
    saveConversations();
    renderConversationsList();
    renderMessages();
    return id;
}

function saveConversations() {
    localStorage.setItem('omega_conversations', JSON.stringify(conversations));
    localStorage.setItem('omega_current_conv', currentConvId);
}

function renderConversationsList() {
    conversationsList.innerHTML = '';
    const sorted = Object.values(conversations).sort((a, b) => b.createdAt - a.createdAt);
    sorted.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item' + (conv.id === currentConvId ? ' active' : '');
        item.innerHTML = `<span class="conv-title"><i class="fas fa-comment"></i> ${conv.title}</span>
            <button class="delete-conv" data-id="${conv.id}"><i class="fas fa-trash"></i></button>`;
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-conv')) switchConversation(conv.id);
        });
        item.querySelector('.delete-conv').addEventListener('click', (e) => {
            e.stopPropagation(); deleteConversation(conv.id);
        });
        conversationsList.appendChild(item);
    });
}

function switchConversation(id) {
    currentConvId = id;
    saveConversations();
    renderConversationsList();
    renderMessages();
    if (window.innerWidth < 768) sidebar.classList.remove('open');
}

function deleteConversation(id) {
    if (!confirm('Supprimer cette conversation ?')) return;
    delete conversations[id];
    const remaining = Object.keys(conversations);
    currentConvId = remaining.length > 0 ? remaining[0] : null;
    saveConversations();
    renderConversationsList();
    renderMessages();
}

function getCurrentConversation() {
    if (!currentConvId || !conversations[currentConvId]) return createNewConversation();
    return conversations[currentConvId];
}

function renderMessages() {
    chatMessages.innerHTML = '';
    const conv = currentConvId ? conversations[currentConvId] : null;
    if (!conv || conv.messages.length === 0) {
        chatMessages.appendChild(createWelcomeScreen());
        return;
    }
    chatTitle.textContent = conv.title;
    conv.messages.forEach(msg => addMessageToDOM(msg.text, msg.sender, false));
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createWelcomeScreen() {
    const div = document.createElement('div');
    div.className = 'welcome-screen';
    div.innerHTML = `<div class="welcome-icon">Ω</div>
        <h2>Bienvenue sur Oméga</h2>
        <p>Votre assistant IA avec streaming temps réel</p>
        <div class="features-grid">
            <div class="feature-card"><i class="fas fa-code"></i><h3>Code complet</h3><p>Génération en temps réel</p></div>
            <div class="feature-card"><i class="fas fa-search"></i><h3>Recherche Web</h3><p>Infos à jour</p></div>
            <div class="feature-card"><i class="fas fa-image"></i><h3>Vision</h3><p>Analyse d'images</p></div>
            <div class="feature-card"><i class="fas fa-brain"></i><h3>Mémoire</h3><p>Contexte conservé</p></div>
        </div>`;
    return div;
}

function addMessageToDOM(text, sender, animate = true) {
    const welcome = chatMessages.querySelector('.welcome-screen');
    if (welcome) welcome.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender);
    if (!animate) messageDiv.style.animation = 'none';
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = sender === 'user' ? 'U' : 'Ω';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    if (sender === 'ai') {
        content.innerHTML = marked.parse(text);
        content.querySelectorAll('pre').forEach(pre => {
            const btn = document.createElement('button');
            btn.className = 'copy-code-btn';
            btn.innerHTML = '<i class="fas fa-copy"></i> Copier';
            btn.onclick = () => {
                const code = pre.querySelector('code').textContent;
                navigator.clipboard.writeText(code);
                btn.innerHTML = '<i class="fas fa-check"></i> Copié !';
                setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i> Copier', 2000);
            };
            pre.style.position = 'relative';
            pre.appendChild(btn);
        });
    } else {
        content.textContent = text;
    }
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return content;
}

// ===== STREAMING =====
async function sendMessage() {
    if (isStreaming) return;
    const message = userInput.value.trim();
    if (!message && !selectedFile) return;
    
    isStreaming = true;
    const conv = getCurrentConversation();
    const selectedVersion = versionSelect.value;
    const enableSearch = searchToggle.checked;
    
    if (conv.messages.length === 0 && message) {
        conv.title = message.substring(0, 40) + (message.length > 40 ? '...' : '');
        chatTitle.textContent = conv.title;
        renderConversationsList();
    }
    
    const displayText = message + (selectedFile ? `\n📎 ${selectedFile.name}` : '');
    conv.messages.push({ text: displayText, sender: 'user' });
    addMessageToDOM(displayText, 'user');
    saveConversations();
    
    userInput.value = '';
    userInput.style.height = 'auto';
    const fileToSend = selectedFile;
    selectedFile = null;
    fileInput.value = '';
    filePreview.style.display = 'none';
    
    userInput.disabled = true;
    sendBtn.disabled = true;
    loading.style.display = 'flex';
    
    // Créer le message AI vide avec curseur
    const aiContent = addMessageToDOM('', 'ai');
    aiContent.classList.add('streaming-cursor');
    
    let fullResponse = '';
    const formData = new FormData();
    formData.append('sessionId', conv.id);
    formData.append('version', selectedVersion);
    formData.append('enableSearch', enableSearch);
    if (message) formData.append('message', message);
    if (fileToSend) formData.append('file', fileToSend);
    
    try {
        const response = await fetch('/api/chat', { method: 'POST', body: formData });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Erreur serveur');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'chunk') {
                            fullResponse += data.text;
                            aiContent.innerHTML = marked.parse(fullResponse);
                            // Re-highlight code
                            aiContent.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        } else if (data.type === 'done') {
                            fullResponse = data.text;
                        } else if (data.type === 'error') {
                            throw new Error(data.error);
                        }
                    } catch (e) {}
                }
            }
        }
        
        conv.messages.push({ text: fullResponse, sender: 'ai' });
        saveConversations();
        
    } catch (error) {
        aiContent.textContent = `Erreur: ${error.message}`;
    } finally {
        aiContent.classList.remove('streaming-cursor');
        userInput.disabled = false;
        sendBtn.disabled = false;
        loading.style.display = 'none';
        userInput.focus();
        isStreaming = false;
    }
}

// ===== ÉVÉNEMENTS =====
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        filePreviewName.textContent = selectedFile.name;
        filePreview.style.display = 'block';
    }
});
removeFileBtn.addEventListener('click', () => {
    selectedFile = null; fileInput.value = ''; filePreview.style.display = 'none';
});
versionSelect.addEventListener('change', () => {
    modelName.textContent = versionSelect.value === '1.5' ? 'Oméga 1.5' : 'Oméga 1.0';
});
newChatBtn.addEventListener('click', () => { createNewConversation(); if (window.innerWidth < 768) sidebar.classList.remove('open'); });
clearChatBtn.addEventListener('click', () => {
    if (!currentConvId) return;
    if (confirm('Effacer tous les messages ?')) {
        conversations[currentConvId].messages = [];
        saveConversations(); renderMessages();
    }
});
themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('omega_theme', newTheme);
    themeToggle.querySelector('i').className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    themeToggle.querySelector('span').textContent = newTheme === 'dark' ? 'Mode clair' : 'Mode sombre';
});
menuBtn.addEventListener('click', () => sidebar.classList.add('open'));
closeSidebar.addEventListener('click', () => sidebar.classList.remove('open'));

(function init() {
    const savedTheme = localStorage.getItem('omega_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeToggle.querySelector('i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    themeToggle.querySelector('span').textContent = savedTheme === 'dark' ? 'Mode clair' : 'Mode sombre';
    if (Object.keys(conversations).length === 0) createNewConversation();
    else { renderConversationsList(); renderMessages(); }
    userInput.focus();
})();
