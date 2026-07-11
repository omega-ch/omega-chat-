const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');
const loading = document.getElementById('loading');
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const versionSelect = document.getElementById('version-select');
const searchToggle = document.getElementById('search-toggle');

let sessionId = localStorage.getItem('chat_session_id');
if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('chat_session_id', sessionId);
}

let selectedFile = null;

function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender);
    messageDiv.textContent = text;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
    const message = userInput.value.trim();
    const selectedVersion = versionSelect.value;
    const enableSearch = searchToggle.checked;
    
    if (!message && !selectedFile) return;
    
    if (message) addMessage(message, 'user');
    if (selectedFile) addMessage(`[Fichier envoyé: ${selectedFile.name}]`, 'user');
    
    userInput.value = '';
    fileNameDisplay.textContent = '';
    const fileToSend = selectedFile;
    selectedFile = null;
    fileInput.value = '';
    
    userInput.disabled = true;
    sendBtn.disabled = true;
    loading.style.display = 'block';
    
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('version', selectedVersion);
    formData.append('enableSearch', enableSearch);
    if (message) formData.append('message', message);
    if (fileToSend) formData.append('file', fileToSend);
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            addMessage(data.response, 'ai');
        } else {
            addMessage(`Erreur: ${data.error}`, 'ai');
        }
    } catch (error) {
        addMessage('Erreur de connexion', 'ai');
    } finally {
        userInput.disabled = false;
        sendBtn.disabled = false;
        loading.style.display = 'none';
        userInput.focus();
    }
}

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        fileNameDisplay.textContent = selectedFile.name;
    }
});

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

userInput.focus();
