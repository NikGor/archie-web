// Streaming status banner shown while agent is processing
const StreamingStatusBanner = ({ statusInfo }) => {
    const { useEffect } = React;

    useEffect(() => {
        if (typeof lucide !== 'undefined') {
            setTimeout(() => lucide.createIcons(), 0);
        }
    }, [statusInfo.step]);

    const toolIconMap = {
        'web_search': 'search',
        'google': 'search',
        'search': 'search',
        'llm': 'brain',
        'think': 'brain',
        'reason': 'brain',
        'image': 'image',
        'fetch': 'globe',
        'browse': 'globe',
        'web': 'globe',
        'memory': 'database',
        'plan': 'list-checks',
        'tool': 'wrench',
        'code': 'code-2',
        'file': 'file-text',
    };

    const getIcon = (step) => {
        if (!step) return 'zap';
        const lower = step.toLowerCase();
        for (const [key, icon] of Object.entries(toolIconMap)) {
            if (lower.includes(key)) return icon;
        }
        return 'zap';
    };

    const icon = getIcon(statusInfo.step);
    const text = statusInfo.message || 'Обрабатываю...';

    return React.createElement('div', {
        className: 'w-full max-w-[60rem] mx-auto mb-4 streaming-status-banner'
    },
        React.createElement('div', {
            className: 'flex items-center gap-3 backdrop-blur-lg rounded-2xl px-5 py-4 bg-white/8 border border-white/15'
        }, [
            React.createElement('div', {
                key: 'pulse',
                className: 'relative flex-shrink-0 w-2.5 h-2.5'
            }, [
                React.createElement('div', {
                    key: 'pulse-ring',
                    className: 'absolute inset-0 rounded-full bg-blue-400/50 animate-ping'
                }),
                React.createElement('div', {
                    key: 'pulse-dot',
                    className: 'absolute inset-0 rounded-full bg-blue-400'
                })
            ]),
            React.createElement('i', {
                key: 'icon',
                'data-lucide': icon,
                className: 'w-4 h-4 text-white/50 flex-shrink-0'
            }),
            React.createElement('span', {
                key: 'text',
                className: 'text-white/70 text-sm truncate'
            }, text)
        ])
    );
};

// Read the conversation id from the current URL path (ChatGPT-style /c/<id>/).
// Returns null when we are on the bare "/" route.
const getConversationIdFromUrl = () => {
    const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
};

// Reflect the active conversation in the address bar without reloading the page.
const syncUrlToConversation = (conversationId, { replace = false } = {}) => {
    const target = conversationId ? `/c/${encodeURIComponent(conversationId)}/` : '/';
    if (window.location.pathname === target) return;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ conversationId: conversationId || null }, '', target);
};

// IntegratedChatAssistant - полноценный чат с AI-driven UI
const IntegratedChatAssistant = () => {
    const { useState, useRef, useEffect } = React;
    
    // State
    const [conversations, setConversations] = useState([]);
    const [currentConversation, setCurrentConversation] = useState(null);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [attachedImages, setAttachedImages] = useState([]);
    const [attachedFiles, setAttachedFiles] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [statusInfo, setStatusInfo] = useState({ message: '', step: '', status: '' });
    const [error, setError] = useState(null);
    const [isLeftSidebarExpanded, setIsLeftSidebarExpanded] = useState(false);
    const [currentMessageIndex, setCurrentMessageIndex] = useState(-1);
    
    const messagesEndRef = useRef(null);
    const api = useRef(new ChatAPI());
    const shouldFollowLatest = useRef(true);

    // Слушаем изменения состояния левого сайдбара
    useEffect(() => {
        const updateSidebarState = () => {
            setIsLeftSidebarExpanded(window.isLeftSidebarExpanded || false);
        };
        
        // Проверяем каждые 100мс
        const interval = setInterval(updateSidebarState, 100);
        return () => clearInterval(interval);
    }, []);

    // Load conversations on mount
    useEffect(() => {
        loadConversations();
    }, []);

    // Sync the open chat with browser back/forward navigation.
    useEffect(() => {
        const handlePopState = () => {
            const urlConversationId = getConversationIdFromUrl();
            if (urlConversationId && urlConversationId !== currentConversation) {
                selectConversation(urlConversationId, { syncUrl: false });
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [currentConversation]);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
        // Re-initialize Lucide icons after messages render
        if (typeof lucide !== 'undefined') {
            setTimeout(() => lucide.createIcons(), 50);
        }
    }, [messages]);

    // Update navigation buttons when messages change or sidebar state changes
    useEffect(() => {
        const assistantMessages = messages.filter(msg => msg.role === 'assistant');
        const currentIndex = currentMessageIndex === -1 ? assistantMessages.length - 1 : currentMessageIndex;
        
        if (window.updateMessageNavigationButtons) {
            window.updateMessageNavigationButtons(currentIndex, assistantMessages.length);
        }
        
        // Если индекс не установлен или нужно следить за последним — показываем последнее
        if (assistantMessages.length > 0 && (currentMessageIndex === -1 || shouldFollowLatest.current)) {
            setCurrentMessageIndex(assistantMessages.length - 1);
        }
        
        // Re-initialize Lucide icons when navigation state changes
        if (typeof lucide !== 'undefined') {
            setTimeout(() => lucide.createIcons(), 50);
        }
    }, [messages, currentMessageIndex, isLeftSidebarExpanded]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const loadConversations = async () => {
        try {
            const convos = await api.current.getConversations();
            setConversations(convos);

            if (currentConversation) return;

            // Prefer the conversation deep-linked in the URL, if it still exists.
            const urlConversationId = getConversationIdFromUrl();
            const urlConvo = urlConversationId
                ? convos.find(c => c.conversation_id === urlConversationId)
                : null;

            if (urlConvo) {
                // Already reflected in the address bar — replace, don't push.
                selectConversation(urlConvo.conversation_id, { syncUrl: false });
            } else if (convos.length > 0) {
                // Auto-select first conversation and rewrite the URL in place.
                selectConversation(convos[0].conversation_id, { replaceUrl: true });
            }
        } catch (err) {
            setError(`Не удалось загрузить чаты: ${err.message}`);
        }
    };

    const selectConversation = async (conversationId, { syncUrl = true, replaceUrl = false } = {}) => {
        shouldFollowLatest.current = true;
        setCurrentConversation(conversationId);
        setCurrentMessageIndex(-1); // Сбрасываем индекс при смене разговора

        if (syncUrl) {
            syncUrlToConversation(conversationId, { replace: replaceUrl });
        }

        try {
            const msgs = await api.current.getMessages(conversationId);
            // Stored attachments are served by URL (browser-cached), same shape as live previews
            setMessages(msgs.map(msg => ({
                ...msg,
                ...(msg.image_count > 0 && {
                    _attachments: Array.from({ length: msg.image_count }, (_, i) => api.current.imageUrl(msg.message_id, i))
                }),
                ...(msg.files && msg.files.length > 0 && {
                    _files: msg.files.map(f => ({ name: f.name, size: f.size, url: api.current.fileUrl(msg.message_id, f.position) }))
                })
            })));
        } catch (err) {
            setError(`Не удалось загрузить сообщения: ${err.message}`);
        }
    };

    const createNewChat = async () => {
        try {
            const newConvo = await api.current.createConversation();
            if (newConvo) {
                setConversations(prev => [newConvo, ...prev]);
                setCurrentConversation(newConvo.conversation_id);
                setMessages([]);
                syncUrlToConversation(newConvo.conversation_id);
            }
        } catch (err) {
            setError(`Не удалось создать новый чат: ${err.message}`);
        }
    };

    const getWebSocketUrl = () => {
        const wsBaseUrl = window.AI_AGENT_WS_URL || 'ws://localhost:8005';
        return wsBaseUrl + '/ws_chat';
    };

    const buildChatHistory = (msgs) => {
        return msgs.map(msg => {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            const content = msg.content;
            let text = '';
            if (typeof content === 'string') {
                text = content;
            } else if (content.text) {
                text = content.text;
            } else if (content.level2_answer?.text?.text) {
                text = content.level2_answer.text.text;
            } else if (content.level3_answer?.text?.text) {
                text = content.level3_answer.text.text;
            } else if (content.ui_answer?.intro_text?.text) {
                // ARCHIE-210: UIAnswer carries its text in intro_text, not text
                text = content.ui_answer.intro_text.text;
            }
            return text ? `${role}: ${text}` : null;
        }).filter(Boolean).join('\n');
    };

    const sendMessageViaWebSocket = (payload, callbacks = {}) => {
        const { onStreamDelta, onPlaceholder, onStreamReasoning, onStatus, onResponseFormat } = callbacks;
        return new Promise((resolve, reject) => {
            const wsUrl = getWebSocketUrl();
            console.log('ChatAssistant: Opening WebSocket to', wsUrl);
            const ws = new WebSocket(wsUrl);
            const pipelineSteps = [];
            let currentStep = null;
            let currentStepStart = null;
            ws.onopen = () => {
                console.log('ChatAssistant: WebSocket connected, sending payload', { ...payload, images: payload.images ? `[${payload.images.length} image(s)]` : null, files: payload.files ? `[${payload.files.length} file(s)]` : null });
                ws.send(JSON.stringify(payload));
            };
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                const now = Date.now();
                console.log('ChatAssistant: WebSocket message', msg);
                switch (msg.type) {
                    case 'status':
                        if (currentStep !== null) {
                            pipelineSteps.push({
                                step: currentStep.step,
                                status: currentStep.status,
                                duration_ms: now - currentStepStart
                            });
                        }
                        currentStep = { step: msg.step || msg.message, status: msg.status || 'running' };
                        currentStepStart = now;
                        setStatusInfo({
                            message: msg.message || `${msg.step}: ${msg.status}`,
                            step: msg.step || '',
                            status: msg.status || 'running'
                        });
                        if (onStatus) onStatus({ message: msg.message || '', step: msg.step || '' });
                        break;
                    case 'response_format':
                        if (onResponseFormat) onResponseFormat(msg.text);
                        break;
                    case 'stream_delta':
                    case 'stream_text':
                        if (onStreamDelta) onStreamDelta(msg.text || msg.delta || '');
                        break;
                    case 'stream_placeholder':
                    case 'placeholder':
                        if (onPlaceholder) onPlaceholder();
                        break;
                    case 'stream_reasoning':
                        if (onStreamReasoning) onStreamReasoning(msg.text || msg.reasoning || '');
                        break;
                    case 'stream_complete':
                        break;
                    case 'stream_error':
                        setStatusInfo({ message: '', step: '', status: '' });
                        reject(new Error(msg.message || 'Stream error'));
                        break;
                    case 'final':
                        if (currentStep !== null) {
                            pipelineSteps.push({
                                step: currentStep.step,
                                status: currentStep.status,
                                duration_ms: now - currentStepStart
                            });
                        }
                        setStatusInfo({ message: '', step: '', status: '' });
                        resolve({ result: msg.data, pipeline_steps: pipelineSteps });
                        break;
                    case 'error':
                        setStatusInfo({ message: '', step: '', status: '' });
                        reject(new Error(msg.message || 'WebSocket error'));
                        break;
                }
            };
            ws.onerror = (error) => {
                console.error('ChatAssistant: WebSocket error', error);
                setStatusInfo({ message: '', step: '', status: '' });
                reject(new Error('WebSocket connection failed'));
            };
            ws.onclose = (event) => {
                console.log('ChatAssistant: WebSocket closed', event.code, event.reason);
            };
        });
    };

    const sendMessage = async (e, overrideText) => {
        if (e && e.preventDefault) e.preventDefault();
        const messageText = (overrideText !== undefined ? overrideText : inputValue).trim();
        if (!messageText || !currentConversation || isLoading) return;

        shouldFollowLatest.current = true;

        const isFirstMessage = messages.length === 0;
        // Attachments only go with a typed message (not quick-action buttons)
        const sentImages = overrideText === undefined ? attachedImages : [];
        const sentFiles = overrideText === undefined ? attachedFiles : [];
        const userMessage = {
            message_id: `temp-user-${Date.now()}`,
            role: 'user',
            content: {
                content_format: 'plain',
                text: messageText
            },
            created_at: new Date().toISOString()
        };

        // _attachments is a session-only preview; it is never saved to the DB
        setMessages(prev => [...prev, (sentImages.length || sentFiles.length)
            ? {
                ...userMessage,
                ...(sentImages.length && { _attachments: sentImages.map(img => img.preview) }),
                ...(sentFiles.length && { _files: sentFiles.map(f => ({
                    name: f.name,
                    size: f.size,
                    url: URL.createObjectURL(new Blob(
                        [Uint8Array.from(atob(f.data), c => c.charCodeAt(0))],
                        { type: f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' }
                    ))
                })) })
            }
            : userMessage]);
        const streamingMsgId = `streaming-${Date.now()}`;
        const selectedFormat = window.selectedResponseFormat || localStorage.getItem('selectedResponseFormat') || 'ui_answer';
        setMessages(prev => [...prev, {
            message_id: streamingMsgId,
            role: 'assistant',
            content: { content_format: selectedFormat, text: '', _streaming: true },
            created_at: new Date().toISOString(),
        }]);
        setInputValue('');
        if (overrideText === undefined) { setAttachedImages([]); setAttachedFiles([]); }
        setIsLoading(true);

        try {
            const selectedCommandModel = window.selectedCommandModel || localStorage.getItem('selectedCommandModel') || 'gpt-4.1';
            const selectedFinalOutputModel = window.selectedFinalOutputModel || localStorage.getItem('selectedFinalOutputModel') || 'gpt-4.1';
            const demoMode = window.demoMode || localStorage.getItem('demoMode') === 'true';
            const noImage = window.noImage || localStorage.getItem('noImage') === 'true';
            const persona = (window.selectedStyle || localStorage.getItem('selectedStyle') || 'butler').toLowerCase();
            const userName = window.CURRENT_USER_NAME || "guest";
            
            // Map frontend format to backend format
            const formatMap = {
                'plain': 'plain',
                'formatted': 'level2_answer',
                'ui_answer': 'ui_answer'
            };
            const backendFormat = formatMap[selectedFormat] || selectedFormat;
            
            // Start title generation in parallel (but don't await yet)
            const titlePromise = isFirstMessage 
                ? api.current.generateTitle(messageText) 
                : Promise.resolve(null);
            
            // Save user message to DB
            await api.current.saveMessage(currentConversation, userMessage);
            if (sentFiles.length) {
                api.current.saveMessageFiles(userMessage.message_id, sentFiles)
                    .catch(err => console.error('ChatAssistant: failed to save files', err));
            }
            if (sentImages.length) {
                // Persist attachments so they survive reloads; a failure must not block the chat
                api.current.saveMessageImages(userMessage.message_id, sentImages)
                    .catch(err => console.error('ChatAssistant: failed to save images', err));
            }
            
            // Find last assistant message for threading
            let previousMessageId = null;
            if (!isFirstMessage) {
                const assistantMessages = messages.filter(msg => msg.role === 'assistant');
                if (assistantMessages.length > 0) {
                    previousMessageId = assistantMessages[assistantMessages.length - 1].message_id;
                }
            }
            
            // Build chat history for context
            const chatHistory = buildChatHistory(messages);
            
            const { result, pipeline_steps } = await sendMessageViaWebSocket({
                user_name: userName,
                response_format: backendFormat,
                input: messageText,
                images: sentImages.length
                    ? sentImages.map(({ media_type, data }) => ({ media_type, data }))
                    : null,
                files: sentFiles.length
                    ? sentFiles.map(({ name, media_type, data }) => ({ name, media_type, data }))
                    : null,
                conversation_id: currentConversation,
                command_model: selectedCommandModel,
                final_output_model: selectedFinalOutputModel,
                previous_message_id: previousMessageId,
                chat_history: chatHistory || null,
                demo_mode: demoMode,
                no_image: noImage,
                persona: persona
            }, {
                onResponseFormat: (format) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, content_format: format } }
                            : msg
                    ));
                },
                onStreamDelta: (text) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, text: (msg.content.text || '') + text } }
                            : msg
                    ));
                },
                onPlaceholder: () => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { content_format: 'ui_answer', _streaming: true, _placeholder: true, _reasoning: '' } }
                            : msg
                    ));
                },
                onStreamReasoning: (text) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, _reasoning: (msg.content._reasoning || '') + text } }
                            : msg
                    ));
                },
                onStatus: ({ message, step }) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, _statusMessage: message, _statusStep: step } }
                            : msg
                    ));
                }
            });

            setMessages(prev => prev.filter(msg => msg.message_id !== streamingMsgId));

            console.log('ChatAssistant: WebSocket result', result);

            // Show message immediately — images will load in background
            const assistantContent = result.content || {};
            const messageId = result.message_id || `temp-assistant-${Date.now()}`;
            const llmTrace = result.llm_trace || {};
            const hasImages = assistantContent.content_format === 'ui_answer' && assistantContent.ui_answer;

            const assistantMessage = {
                message_id: messageId,
                role: 'assistant',
                content: assistantContent,
                created_at: result.created_at || new Date().toISOString(),
                llm_trace: llmTrace,
                pipeline_steps: pipeline_steps || [],
                pipeline_trace: result.pipeline_trace || null,
                // Saved with the message: chat monitoring judges it by this format (ARCHIE-213)
                response_format: result.response_format || null,
                model: result.model || null
            };

            console.log('ChatAssistant: assistantMessage', assistantMessage);
            setMessages(prev => [...prev, assistantMessage]);

            // Update title while images load in background
            const title = await titlePromise;
            if (title) {
                try {
                    await api.current.updateConversationTitle(currentConversation, title);
                    setConversations(prev => prev.map(c =>
                        c.conversation_id === currentConversation
                            ? { ...c, title }
                            : c
                    ));
                } catch (e) {
                    console.error('Failed to update title:', e);
                }
            }

            // Process images and save to DB in background (non-blocking)
            ;(async () => {
                let finalContent = assistantContent;
                let finalSteps = [...(pipeline_steps || [])];
                let finalTrace = { ...llmTrace };

                if (hasImages) {
                    try {
                        console.log('ChatAssistant: Processing images in background');
                        const imageGenStart = Date.now();
                        const imageResult = await api.current.processImages(assistantContent.ui_answer);
                        finalSteps.push({
                            step: 'image_generation',
                            status: 'done',
                            duration_ms: Date.now() - imageGenStart
                        });
                        const processedUiAnswer = imageResult?.ui_answer ?? imageResult;
                        const imageCost = imageResult?.imageCost || 0;
                        finalTrace = { ...llmTrace, total_cost: (llmTrace.total_cost || 0) + imageCost };
                        finalContent = { ...assistantContent, ui_answer: processedUiAnswer };

                        // Replace placeholders with real images
                        setMessages(prev => prev.map(msg =>
                            msg.message_id === messageId
                                ? { ...msg, content: finalContent, llm_trace: finalTrace, pipeline_steps: finalSteps }
                                : msg
                        ));
                    } catch (err) {
                        console.error('ChatAssistant: Image generation failed', err);
                    }
                }

                try {
                    const finalMessage = { ...assistantMessage, content: finalContent, llm_trace: finalTrace, pipeline_steps: finalSteps };
                    await api.current.saveMessage(currentConversation, finalMessage);
                } catch (err) {
                    console.error('ChatAssistant: Failed to save message', err);
                }
            })();
        } catch (err) {
            setError(`Не удалось отправить сообщение: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const executeCommand = async (assistantRequest) => {
        if (!currentConversation || isLoading) return;

        shouldFollowLatest.current = true;

        // Add user message to chat
        const userMessage = {
            message_id: `temp-user-${Date.now()}`,
            role: 'user',
            content: {
                content_format: 'plain',
                text: assistantRequest
            },
            created_at: new Date().toISOString()
        };

        setMessages(prev => [...prev, userMessage]);
        const streamingMsgId = `streaming-${Date.now()}`;
        const selectedFormat = window.selectedResponseFormat || localStorage.getItem('selectedResponseFormat') || 'ui_answer';
        setMessages(prev => [...prev, {
            message_id: streamingMsgId,
            role: 'assistant',
            content: { content_format: selectedFormat, text: '', _streaming: true },
            created_at: new Date().toISOString(),
        }]);
        setIsLoading(true);

        try {
            const selectedCommandModel = window.selectedCommandModel || localStorage.getItem('selectedCommandModel') || 'gpt-4.1';
            const selectedFinalOutputModel = window.selectedFinalOutputModel || localStorage.getItem('selectedFinalOutputModel') || 'gpt-4.1';
            const demoMode = window.demoMode || localStorage.getItem('demoMode') === 'true';
            const noImage = window.noImage || localStorage.getItem('noImage') === 'true';
            const persona = (window.selectedStyle || localStorage.getItem('selectedStyle') || 'butler').toLowerCase();
            const userName = window.CURRENT_USER_NAME || "guest";

            // Map frontend format to backend format
            const formatMap = {
                'plain': 'plain',
                'formatted': 'level2_answer',
                'ui_answer': 'ui_answer'
            };
            const backendFormat = formatMap[selectedFormat] || selectedFormat;

            // Save user message to DB
            await api.current.saveMessage(currentConversation, userMessage);

            // Find last assistant message for threading
            let prevMessageId = null;
            const assistantMsgs = messages.filter(msg => msg.role === 'assistant');
            if (assistantMsgs.length > 0) {
                prevMessageId = assistantMsgs[assistantMsgs.length - 1].message_id;
            }

            // Build chat history for context
            const chatHistoryForExecute = buildChatHistory(messages);

            const { result, pipeline_steps } = await sendMessageViaWebSocket({
                user_name: userName,
                response_format: backendFormat,
                input: assistantRequest,
                conversation_id: currentConversation,
                command_model: selectedCommandModel,
                final_output_model: selectedFinalOutputModel,
                previous_message_id: prevMessageId,
                chat_history: chatHistoryForExecute || null,
                demo_mode: demoMode,
                no_image: noImage,
                persona: persona
            }, {
                onResponseFormat: (format) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, content_format: format } }
                            : msg
                    ));
                },
                onStreamDelta: (text) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, text: (msg.content.text || '') + text } }
                            : msg
                    ));
                },
                onPlaceholder: () => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { content_format: 'ui_answer', _streaming: true, _placeholder: true, _reasoning: '' } }
                            : msg
                    ));
                },
                onStreamReasoning: (text) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, _reasoning: (msg.content._reasoning || '') + text } }
                            : msg
                    ));
                },
                onStatus: ({ message, step }) => {
                    setMessages(prev => prev.map(msg =>
                        msg.message_id === streamingMsgId
                            ? { ...msg, content: { ...msg.content, _statusMessage: message, _statusStep: step } }
                            : msg
                    ));
                }
            });

            setMessages(prev => prev.filter(msg => msg.message_id !== streamingMsgId));

            // Show message immediately — images will load in background
            const assistantContent = result.content || {};
            const messageId = result.message_id || `temp-assistant-${Date.now()}`;
            const llmTrace = result.llm_trace || {};
            const hasImages = assistantContent.content_format === 'ui_answer' && assistantContent.ui_answer;

            const assistantMessage = {
                message_id: messageId,
                role: 'assistant',
                content: assistantContent,
                created_at: result.created_at || new Date().toISOString(),
                llm_trace: llmTrace,
                pipeline_steps: pipeline_steps || [],
                pipeline_trace: result.pipeline_trace || null,
                // Saved with the message: chat monitoring judges it by this format (ARCHIE-213)
                response_format: result.response_format || null,
                model: result.model || null
            };

            setMessages(prev => [...prev, assistantMessage]);

            // Process images and save to DB in background (non-blocking)
            ;(async () => {
                let finalContent = assistantContent;
                let finalSteps = [...(pipeline_steps || [])];
                let finalTrace = { ...llmTrace };

                if (hasImages) {
                    try {
                        const imageGenStart = Date.now();
                        const imageResult = await api.current.processImages(assistantContent.ui_answer);
                        finalSteps.push({
                            step: 'image_generation',
                            status: 'done',
                            duration_ms: Date.now() - imageGenStart
                        });
                        const processedUiAnswer = imageResult?.ui_answer ?? imageResult;
                        const imageCost = imageResult?.imageCost || 0;
                        finalTrace = { ...llmTrace, total_cost: (llmTrace.total_cost || 0) + imageCost };
                        finalContent = { ...assistantContent, ui_answer: processedUiAnswer };

                        setMessages(prev => prev.map(msg =>
                            msg.message_id === messageId
                                ? { ...msg, content: finalContent, llm_trace: finalTrace, pipeline_steps: finalSteps }
                                : msg
                        ));
                    } catch (err) {
                        console.error('ChatAssistant: Image generation failed', err);
                    }
                }

                try {
                    const finalMessage = { ...assistantMessage, content: finalContent, llm_trace: finalTrace, pipeline_steps: finalSteps };
                    await api.current.saveMessage(currentConversation, finalMessage);
                } catch (err) {
                    console.error('ChatAssistant: Failed to save message', err);
                }
            })();
        } catch (err) {
            setError(`Ошибка выполнения команды: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const navigateMessages = (direction) => {
        const assistantMessages = messages.filter(msg => msg.role === 'assistant');
        if (assistantMessages.length === 0) return;

        shouldFollowLatest.current = false;
        let newIndex = currentMessageIndex;
        
        if (direction === 'prev') {
            newIndex = Math.max(0, currentMessageIndex - 1);
        } else if (direction === 'next') {
            newIndex = Math.min(assistantMessages.length - 1, currentMessageIndex + 1);
        }

        if (newIndex !== currentMessageIndex) {
            setCurrentMessageIndex(newIndex);
        }
    };

    const updateNavigationButtons = () => {
        const assistantMessages = messages.filter(msg => msg.role === 'assistant');
        const currentIndex = currentMessageIndex === -1 ? assistantMessages.length - 1 : currentMessageIndex;
        
        if (window.updateMessageNavigationButtons) {
            window.updateMessageNavigationButtons(currentIndex, assistantMessages.length);
        }
    };

    // Expose functions globally for left sidebar integration
    useEffect(() => {
        window.chatAssistantAPI = {
            createNewChat,
            conversations,
            currentConversation,
            selectConversation,
            navigateMessages,
            updateNavigationButtons,
            getCurrentConversationId: () => currentConversation?.conversation_id || null,
            sendMessage: (message) => {
                if (currentConversation) {
                    sendMessage(null, message);
                }
            }
        };
    }, [conversations, currentConversation, navigateMessages, updateNavigationButtons]);

    if (!currentConversation) {
        return React.createElement('div', {
            className: 'h-full flex flex-col items-center justify-center text-center'
        }, [
            React.createElement('div', {
                key: 'empty-state',
                className: 'text-white/60'
            }, [
                React.createElement('i', {
                    key: 'icon',
                    'data-lucide': 'message-circle',
                    className: 'w-16 h-16 mx-auto mb-4'
                }),
                React.createElement('h3', {
                    key: 'title',
                    className: 'text-xl font-semibold mb-2'
                }, 'Выберите чат'),
                React.createElement('p', {
                    key: 'description',
                    className: 'text-sm'
                }, 'Создайте новый чат или выберите существующий из левой панели'),
                React.createElement('button', {
                    key: 'create-button',
                    onClick: createNewChat,
                    className: 'mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full transition-colors'
                }, 'Создать новый чат')
            ])
        ]);
    }

    // Определяем, что показывать: диалог или конкретное сообщение по индексу
    const messagesToShow = (() => {
        if (isLeftSidebarExpanded) {
            return messages; // Показываем все сообщения в развернутом режиме
        } else {
            // В свернутом режиме показываем только сообщения ассистента
            const assistantMessages = messages.filter(msg => msg.role === 'assistant');
            if (assistantMessages.length === 0) return [];
            
            // Показываем сообщение по currentMessageIndex или последнее
            const index = currentMessageIndex >= 0 && currentMessageIndex < assistantMessages.length 
                ? currentMessageIndex 
                : assistantMessages.length - 1;
            
            return [assistantMessages[index]];
        }
    })();

    return React.createElement('div', {
        className: 'h-full flex flex-col bg-transparent'
    }, [
        // Messages area
        React.createElement('div', {
            key: 'messages-area',
            className: `flex-1 overflow-y-auto px-4 ${!isLeftSidebarExpanded ? 'py-4' : 'py-4'}`
        }, [
            // В свернутом режиме с одним сообщением — центрируем по вертикали
            !isLeftSidebarExpanded && messagesToShow.length === 1
                ? React.createElement('div', {
                    key: 'single-message-container',
                    className: 'min-h-full flex flex-col justify-center'
                }, [
                    React.createElement('div', {
                        key: 'centered-message',
                        className: 'w-full max-w-[60rem] mx-auto'
                    }, messagesToShow.map(message =>
                        React.createElement(ChatMessage, {
                            key: message.message_id,
                            message: message,
                            onExecute: executeCommand
                        })
                    ))
                ])
                : React.createElement('div', {
                    key: 'messages-container',
                    className: 'w-full max-w-[60rem] mx-auto'
                }, messagesToShow.map(message =>
                    React.createElement(ChatMessage, {
                        key: message.message_id,
                        message: message,
                        onExecute: executeCommand
                    })
                )),
            isLoading && !messages.some(m => m.content?._streaming || m.content?._placeholder) && React.createElement(StreamingStatusBanner, {
                key: `loading-${statusInfo.step}`,
                statusInfo: statusInfo
            }),
            React.createElement('div', {
                key: 'messages-end',
                ref: messagesEndRef
            })
        ]),
        
        // Input area
        React.createElement('div', {
            key: 'input-area',
            className: 'p-4'
        }, [
            React.createElement(ChatInput, {
                key: 'chat-input',
                value: inputValue,
                onChange: setInputValue,
                onSubmit: sendMessage,
                disabled: !currentConversation,
                isLoading: isLoading,
                images: attachedImages,
                onImagesChange: setAttachedImages,
                files: attachedFiles,
                onFilesChange: setAttachedFiles
            })
        ]),

        // Error display
        error && React.createElement('div', {
            key: 'error',
            className: 'fixed bottom-4 right-4 bg-red-600 text-white px-6 py-3 rounded-full shadow-lg'
        }, [
            React.createElement('span', { key: 'error-text' }, error),
            React.createElement('button', {
                key: 'error-close',
                onClick: () => setError(null),
                className: 'ml-3 text-white/80 hover:text-white'
            }, React.createElement('i', {
                'data-lucide': 'x',
                className: 'w-4 h-4'
            }))
        ])
    ]);
};
