// Initialize AI Assistant
function initializeChatAssistant() {
    const chatContainer = document.getElementById('chat-assistant-root');
    if (!chatContainer) {
        console.error('Chat assistant container not found');
        return;
    }

    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        console.error('React or ReactDOM not loaded');
        return;
    }

    try {
        const root = ReactDOM.createRoot(chatContainer);
        root.render(React.createElement(IntegratedChatAssistant));
        
        // Re-initialize Lucide icons
        setTimeout(() => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 100);
        
        console.log('Integrated AI Assistant initialized successfully');
    } catch (error) {
        console.error('Failed to initialize AI Assistant:', error);
        chatContainer.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center text-white/60">
                    <p class="text-lg">AI Assistant загружается...</p>
                    <p class="text-sm mt-2">Если проблема не исчезает, обновите страницу</p>
                </div>
            </div>
        `;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initializeChatAssistant, 100);
});