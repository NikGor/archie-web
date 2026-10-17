// ChatAPI class - simplified version of the original
class ChatAPI {
    constructor() {
        this.baseUrl = '/ai-assistant/api';
    }

    async getConversations() {
        try {
            const response = await fetch(`${this.baseUrl}/conversations/`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get conversations:', error);
            return [];
        }
    }

    async createConversation() {
        try {
            const response = await fetch(`${this.baseUrl}/conversations/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: `Новый чат ${Date.now()}` })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to create conversation:', error);
            return null;
        }
    }

    async getMessages(conversationId) {
        try {
            const response = await fetch(`${this.baseUrl}/conversations/${conversationId}/messages/`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get messages:', error);
            return [];
        }
    }

    async sendMessage(messageData) {
        try {
            const response = await fetch(`${this.baseUrl}/messages/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(messageData)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to send message:', error);
            throw error;
        }
    }

    async deleteConversation(conversationId) {
        try {
            const response = await fetch(`${this.baseUrl}/conversations/${conversationId}/`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error('Failed to delete conversation:', error);
            throw error;
        }
    }

    async updateConversationTitle(conversationId, title) {
        try {
            const response = await fetch(`${this.baseUrl}/conversations/${conversationId}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to update conversation title:', error);
            throw error;
        }
    }

    async generateTitle(userMessage) {
        try {
            const response = await fetch(`${this.baseUrl}/generate-title/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            return result.title || null;
        } catch (error) {
            console.error('Failed to generate title:', error);
            return null;
        }
    }

    async processImages(uiAnswer) {
        try {
            const response = await fetch(`${this.baseUrl}/process-images/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ui_answer: uiAnswer })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            return { ui_answer: result.ui_answer, imageCost: result.image_cost || 0 };
        } catch (error) {
            console.error('Failed to process images:', error);
            return { ui_answer: uiAnswer, imageCost: 0 };
        }
    }

    async saveMessageImages(messageId, images) {
        const response = await fetch(`${this.baseUrl}/messages/${encodeURIComponent(messageId)}/images/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: images.map(({ media_type, data }) => ({ media_type, data })) })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    async saveMessageFiles(messageId, files) {
        const response = await fetch(`${this.baseUrl}/messages/${encodeURIComponent(messageId)}/files/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: files.map(({ name, media_type, data }) => ({ name, media_type, data })) })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    fileUrl(messageId, position) {
        return `${this.baseUrl}/messages/${encodeURIComponent(messageId)}/files/${position}/`;
    }

    imageUrl(messageId, position) {
        return `${this.baseUrl}/messages/${encodeURIComponent(messageId)}/images/${position}/`;
    }

    async saveMessage(conversationId, message) {
        try {
            const response = await fetch(`${this.baseUrl}/save-message/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: conversationId, message: message })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to save message:', error);
            throw error;
        }
    }
}
