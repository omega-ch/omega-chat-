// ===== CONFIGURATION MARKDOWN =====
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true
});

// ===== ÉLÉMENTS DOM =====
const DOM = {
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    chatMessages: document.getElementById('chat-messages'),
    loading: document.getElementById('loading'),
    fileInput: document.getElementById('file-input'),
    versionSelect: document.getElementById('version-select'),
    searchToggle: document.getElementById('search-toggle'),
    chatTitle: document.getElementById('chat-title'),
    modelName: document.querySelector('.model-name'),
    themeToggle: document.getElementById('theme-toggle'),
    sidebar: document.getElementById('sidebar'),
    menuBtn: document.getElementById('menu-btn'),
    closeSidebar: document.getElementById('close-sidebar'),
    newChatBtn: document.getElementById('new-chat-btn'),
    conversationsList: document.getElementById('conversations-list'),
    clearChatBtn: document.getElementById('clear-chat-btn'),
    filePreview: document.getElementById('file-preview'),
    filePreviewName: document.getElementById('file-preview-name'),
    removeFileBtn: document.getElementById('remove-file')
};

// ===== ÉTAT GLOBAL =====
const State = {
    conversations: JSON.parse(localStorage.getItem('omega_conversations') || '{}'),
    currentConvId: localStorage.getItem('omega_current_conv') || null,
    selectedFile: null,
    isStreaming: false
};

// ===== UTILITAIRES =====
const Utils = {
    generateId: () => 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    
    save: () => {
        localStorage.setItem('omega_conversations', JSON.stringify(State.conversations));
        localStorage.setItem('omega_current_conv', State.currentConvId);
    },
    
    escapeHtml: (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    debounce: (fn, delay) => {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }
};

// ===== GESTION DES CONVERSATIONS =====
function createNewConversation() {
    const id = Utils.generateId();
    State.conversations[id] = {
        id,
        title: 'Nouvelle conversation',
        messages: [],
        createdAt: Date.now()
    };
    State.currentConvId = id;
    Utils.save();
    renderConversationsList();
    renderMessages();
    return id;
}

function renderConversationsList() {
    DOM.conversationsList.innerHTML = '';
    const sorted = Object.values(State.conversations)
        .sort((a, b) => b.createdAt - a.createdAt);
    
    sorted.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conversation-item' + (conv.id === State.currentConvId ? ' active' : '');
        item.innerHTML = `
            <span class="conv-title"><i class="fas fa-comment"></i> ${Utils.escapeHtml(conv.title)}</span>
            <button class="delete-conv" data-id="${conv.id}" title="Supprimer">
                <i class="fas fa-trash"></i>
            </button>
        `;
        
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-conv')) {
                switchConversation(conv.id);
            }
        });
        
        item.querySelector('.delete-conv').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConversation(conv.id);
        });
        
        DOM.conversationsList.appendChild(item);
    });
}

function switchConversation(id) {
    State.currentConvId = id;
    Utils.save();
    renderConversationsList();
    renderMessages();
    if (window.innerWidth < 768) DOM.sidebar.classList.remove('open');
}

function deleteConversation(id) {
    if (!confirm('Supprimer cette conversation ?')) return;
    delete State.conversations[id];
    
    const remaining = Object.keys(State.conversations);
    State.currentConvId = remaining.length > 0 ? remaining[0] : null;
    
    Utils.save();
    renderConversationsList();
    renderMessages();
}

function getCurrentConversation() {
    if (!State.currentConvId || !State.conversations[State.currentConvId]) {
        return createNewConversation();
    }
    return State.conversations[State.currentConvId];
}

// ===== RENDU DES MESSAGES =====
function renderMessages() {
    DOM.chatMessages.innerHTML = '';
    const conv = State.currentConvId ? State.conversations[State.currentConvId] : null;
    
    if (!conv || conv.messages.length === 0) {
        DOM.chatMessages.appendChild(createWelcomeScreen());
        return;
    }
    
    DOM.chatTitle.textContent = conv.title;
    conv.messages.forEach(msg => addMessageToDOM(msg.text, msg.sender, false));
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function createWelcomeScreen() {
    const div = document.createElement('div');
    div.className = 'welcome-screen';
    div.innerHTML = `
        <div class="welcome-icon">Ω</div>
        <h2>Bienvenue sur Oméga</h2>
        <p>Votre assistant IA avancé avec recherche web et génération de code</p>
        <div class="features-grid">
            <div class="feature-card">
                <i class="fas fa-code"></i>
                <h3>Code complet</h3>
                <p>Génération de code fonctionnel</p>
            </div>
            <div class="feature-card">
                <i class="fas fa-search"></i>
                <h3>Recherche Web</h3>
                <p>Infos à jour en temps réel</p>
            </div>
            <div class="feature-card">
                <i class="fas fa-image"></i>
                <h3>Vision</h3>
                <p>Analyse d'images et documents</p>
            </div>
            <div class="feature-card">
                <i class="fas fa-brain"></i>
                <h3>Mémoire</h3>
                <p>Contexte conservé</p>
            </div>
        </div>
    `;
    return div;
}

function addMessageToDOM(text, sender, animate = true) {
    console.log('📝 Ajout message au DOM:', { sender, textLength: text?.length });
    
    const welcome = DOM.chatMessages.querySelector('.welcome-screen');
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
        try {
            content.innerHTML = marked.parse(text || '');
            content.querySelectorAll('pre').forEach(pre => {
                const btn = document.createElement('button');
                btn.className = 'copy-code-btn';
                btn.innerHTML = '<i class="fas fa-copy"></i> Copier';
                btn.onclick = () => {
                    const code = pre.querySelector('code')?.textContent || '';
                    navigator.clipboard.writeText(code).then(() => {
                        btn.innerHTML = '<i class="fas fa-check"></i> Copié !';
                        setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i> Copier', 2000);
                    });
                };
                pre.style.position = 'relative';
                pre.appendChild(btn);
            });
        } catch (error) {
            console.error('❌ Erreur markdown:', error);
            content.textContent = text || '';
        }
    } else {
        content.textContent = text;
    }
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    DOM.chatMessages.appendChild(messageDiv);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    
    console.log('✅ Message ajouté au DOM');
    return content;
}

// ===== ENVOI DE MESSAGE (CORRIGÉ AVEC LOGS) =====
async function sendMessage() {
    console.log('\n========== NOUVEL ENVOI ==========');
    
    if (State.isStreaming) {
        console.log('⚠️ Déjà en cours d\'envoi');
        return;
    }
    
    const message = DOM.userInput.value.trim();
    console.log('📤 Message à envoyer:', message);
    
    if (!message && !State.selectedFile) {
        console.log('⚠️ Rien à envoyer');
        return;
    }
    
    State.isStreaming = true;
    const conv = getCurrentConversation();
    const selectedVersion = DOM.versionSelect.value;
    const enableSearch = DOM.searchToggle.checked;
    
    console.log('📋 Conversation:', conv.id);
    console.log('🤖 Version:', selectedVersion);
    console.log('🔍 Recherche:', enableSearch);
    
    // Titre auto
    if (conv.messages.length === 0 && message) {
        conv.title = message.substring(0, 40) + (message.length > 40 ? '...' : '');
        DOM.chatTitle.textContent = conv.title;
        renderConversationsList();
    }
    
    // Message utilisateur
    const displayText = message + (State.selectedFile ? `\n📎 ${State.selectedFile.name}` : '');
    conv.messages.push({ text: displayText, sender: 'user' });
    addMessageToDOM(displayText, 'user');
    Utils.save();
    
    // Reset input
    DOM.userInput.value = '';
    DOM.userInput.style.height = 'auto';
    const fileToSend = State.selectedFile;
    State.selectedFile = null;
    DOM.fileInput.value = '';
    DOM.filePreview.style.display = 'none';
    
    // UI loading
    DOM.userInput.disabled = true;
    DOM.sendBtn.disabled = true;
    DOM.loading.style.display = 'flex';
    
    // Message AI placeholder
    const aiContent = addMessageToDOM('⏳ Oméga réfléchit...', 'ai');
    
    const formData = new FormData();
    formData.append('sessionId', conv.id);
    formData.append('version', selectedVersion);
    formData.append('enableSearch', enableSearch);
    if (message) formData.append('message', message);
    if (fileToSend) formData.append('file', fileToSend);
    
    console.log('📡 Envoi de la requête au serveur...');
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log('📥 Réponse reçue, statut:', response.status);
        
        if (!response.ok) {
            let errorMsg = `Erreur ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorData.details || errorMsg;
                console.error('❌ Erreur serveur:', errorData);
            } catch (e) {
                console.error('❌ Impossible de parser l\'erreur');
            }
            throw new Error(errorMsg);
        }
        
        console.log('🔄 Parsing JSON...');
        const data = await response.json();
        console.log('✅ Données reçues:', data);
        
        if (!data.response) {
            console.error('❌ Pas de réponse dans les données:', data);
            throw new Error('Réponse vide du serveur');
        }
        
        console.log('📝 Affichage de la réponse...');
        
        // Affichage réponse
        try {
            aiContent.innerHTML = marked.parse(data.response);
            aiContent.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
            console.log('✅ Réponse affichée avec markdown');
        } catch (error) {
            console.error('❌ Erreur lors de l\'affichage:', error);
            aiContent.textContent = data.response;
        }
        
        // Sauvegarde
        conv.messages.push({ text: data.response, sender: 'ai' });
        Utils.save();
        console.log('✅ Conversation sauvegardée');
        
    } catch (error) {
        console.error('❌ ERREUR:', error);
        console.error('❌ Type:', error.name);
        console.error('❌ Message:', error.message);
        
        let errorMsg = 'Erreur de connexion';
        
        if (error.name === 'AbortError') {
            errorMsg = '⏱️ Délai dépassé (2 min). Réessayez.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMsg = '❌ Serveur injoignable.\n\nVérifiez :\n• L\'app est active sur Render\n• UptimeRobot est configuré\n• Les clés API sont valides';
        } else {
            errorMsg = '❌ ' + error.message;
        }
        
        aiContent.textContent = errorMsg;
        aiContent.style.whiteSpace = 'pre-line';
        aiContent.style.color = '#ff4444';
    } finally {
        console.log('🏁 Fin de l\'envoi');
        DOM.userInput.disabled = false;
        DOM.sendBtn.disabled = false;
        DOM.loading.style.display = 'none';
        DOM.userInput.focus();
        State.isStreaming = false;
    }
}

// ===== AUTO-RESIZE TEXTAREA =====
const autoResize = Utils.debounce(() => {
    DOM.userInput.style.height = 'auto';
    DOM.userInput.style.height = Math.min(DOM.userInput.scrollHeight, 150) + 'px';
}, 50);

// ===== GESTION THÈME =====
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('omega_theme', theme);
    DOM.themeToggle.querySelector('i').className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    DOM.themeToggle.querySelector('span').textContent = theme === 'dark' ? 'Mode clair' : 'Mode sombre';
}

// ===== ÉVÉNEMENTS =====
DOM.sendBtn.addEventListener('click', sendMessage);

DOM.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

DOM.userInput.addEventListener('input', autoResize);

DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        State.selectedFile = e.target.files[0];
        DOM.filePreviewName.textContent = State.selectedFile.name;
        DOM.filePreview.style.display = 'block';
    }
});

DOM.removeFileBtn.addEventListener('click', () => {
    State.selectedFile = null;
    DOM.fileInput.value = '';
    DOM.filePreview.style.display = 'none';
});

DOM.versionSelect.addEventListener('change', () => {
    DOM.modelName.textContent = DOM.versionSelect.value === '1.5' ? 'Oméga 1.5' : 'Oméga 1.0';
});

DOM.newChatBtn.addEventListener('click', () => {
    createNewConversation();
    if (window.innerWidth < 768) DOM.sidebar.classList.remove('open');
});

DOM.clearChatBtn.addEventListener('click', () => {
    if (!State.currentConvId) return;
    if (confirm('Effacer tous les messages de cette conversation ?')) {
        State.conversations[State.currentConvId].messages = [];
        Utils.save();
        renderMessages();
    }
});

DOM.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
});

DOM.menuBtn.addEventListener('click', () => DOM.sidebar.classList.add('open'));
DOM.closeSidebar.addEventListener('click', () => DOM.sidebar.classList.remove('open'));

document.addEventListener('click', (e) => {
    if (window.innerWidth < 768 && 
        DOM.sidebar.classList.contains('open') &&
        !DOM.sidebar.contains(e.target) && 
        e.target !== DOM.menuBtn) {
        DOM.sidebar.classList.remove('open');
    }
});

// ===== INITIALISATION =====
(function init() {
    console.log('🚀 Initialisation Oméga Chat...');
    
    const savedTheme = localStorage.getItem('omega_theme') || 'light';
    applyTheme(savedTheme);
    
    if (Object.keys(State.conversations).length === 0) {
        createNewConversation();
    } else {
        renderConversationsList();
        renderMessages();
    }
    
    DOM.userInput.focus();
    console.log('✅ Oméga Chat initialisé');
})();
