// Рендеринг плиток Дашборда
function renderDashboardGrid(dashboardData = null) {
    globalQuickActionsContainer.innerHTML = '';
    dashboardTilesContainer.innerHTML = '';
    
    // Use provided data or fall back to static data from data.js
    const data = dashboardData || window.dashboardData;
    
    if (!data) {
        console.error('No dashboard data available');
        return;
    }
    
    // Convert new Dashboard structure (light, climate, music, etc.) to tiles array
    const tiles = [
        { ...data.light, category: 'light' },
        { ...data.climate, category: 'climate' },
        { ...data.music, category: 'music' },
        { ...data.documents, category: 'documents' },
        { ...data.apps, category: 'apps' },
        { ...data.settings, category: 'settings' }
    ];
    
    // Определяем ориентацию экрана и разрешение
    const isLandscape = window.innerWidth > window.innerHeight;
    const isTabletLandscape = isLandscape && window.innerHeight <= 720;
    const isVeryLowScreen = isLandscape && window.innerHeight <= 600;
    
    // Устанавливаем CSS Grid классы в зависимости от ориентации
    let containerClasses = 'grid gap-6 mb-6';
    let tilesClasses = 'glass-tile rounded-2xl p-6 flex flex-col justify-between aspect-square cursor-pointer';
    let quickActionsClasses = 'flex flex-wrap gap-3';
    
    if (isLandscape) {
        containerClasses += ' grid-cols-3 grid-rows-2 max-w-5xl mx-auto';
        quickActionsClasses += ' max-w-5xl mx-auto';
    } else {
        containerClasses += ' grid-cols-2 grid-rows-3 max-w-2xl mx-auto';
        quickActionsClasses += ' max-w-2xl mx-auto';
    }
    
    if (isVeryLowScreen) {
        containerClasses += ' dashboard-tiles-compact';
        tilesClasses += ' dashboard-tile-compact';
        quickActionsClasses += ' quick-actions-compact';
        
        const dashboardContainer = dashboardTilesContainer.parentElement.parentElement;
        if (dashboardContainer) {
            dashboardContainer.classList.add('dashboard-compact');
        }
    } else if (isTabletLandscape) {
        containerClasses += ' dashboard-tiles-compact';
        tilesClasses += ' dashboard-tile-compact';
        quickActionsClasses += ' quick-actions-compact';
        
        const dashboardContainer = dashboardTilesContainer.parentElement.parentElement;
        if (dashboardContainer) {
            dashboardContainer.classList.add('dashboard-compact');
        }
    } else {
        const dashboardContainer = dashboardTilesContainer.parentElement.parentElement;
        if (dashboardContainer) {
            dashboardContainer.classList.remove('dashboard-compact');
        }
    }
    
    dashboardTilesContainer.className = containerClasses;
    globalQuickActionsContainer.className = quickActionsClasses;
    
    // Render quick action buttons (AssistantButton) - switch to chat mode
    if (data.quick_actions) {
        data.quick_actions.forEach(action => {
            const button = document.createElement('button');
            let buttonClasses = ['glass-button', 'px-6', 'py-3', 'rounded-lg', 'text-white', 'flex', 'items-center', 'gap-3', 'text-lg', 'font-medium'];
            
            if (isVeryLowScreen) {
                buttonClasses.push('quick-action-btn-compact');
            } else if (isTabletLandscape) {
                buttonClasses.push('quick-action-btn-compact');
            }
            
            if (action.style === 'primary') buttonClasses.push('btn-primary');
            else if (action.style === 'secondary') buttonClasses.push('btn-secondary');
            button.className = buttonClasses.join(' ');
            button.innerHTML = `<i data-lucide="${action.icon}" class="w-6 h-6"></i><span>${action.text}</span>`;
            
            // Global quick actions open chat and send message
            button.onclick = () => {
                // Switch to chat view
                if (typeof showChatView === 'function') {
                    showChatView();
                }
                
                // Send message to chat assistant
                if (window.chatAssistantAPI) {
                    // Get current conversation or create new one
                    const currentConversationId = window.chatAssistantAPI.getCurrentConversationId?.();
                    
                    if (currentConversationId) {
                        // Send to existing conversation
                        window.chatAssistantAPI.sendMessage(action.assistant_request);
                    } else {
                        // Create new conversation and send message
                        fetch('/ai-assistant/api/conversations/', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        })
                        .then(response => response.json())
                        .then(newChat => {
                            window.chatAssistantAPI.selectConversation(newChat.conversation_id);
                            // Send message after conversation is selected
                            setTimeout(() => {
                                window.chatAssistantAPI.sendMessage(action.assistant_request);
                            }, 100);
                        })
                        .catch(error => console.error('Error creating new chat:', error));
                    }
                }
            };
            
            globalQuickActionsContainer.appendChild(button);
        });
    }

    tiles.forEach(tile => {
        const tileElement = document.createElement('div');
        tileElement.className = tilesClasses;
        
        // Tiles themselves don't trigger AI - they just show data
        tileElement.style.cursor = 'default';
        
        const statusIconColorClass = getTailwindColorClass(tile.status_color);

        let devicesHtml = '';
        if (tile.devices && tile.devices.length > 0) {
            devicesHtml = `<div class="mt-4 flex flex-wrap gap-3">
                ${tile.devices.map(device => {
                    const deviceIconColorClass = getTailwindColorClass(device.color);
                    const deviceBgColorClass = device.variant === 'solid' ? getTailwindBgColorClass(device.color) : '';
                    return `
                        <div class="relative device-wrapper">
                            <div class="device-icon ${device.variant === 'solid' ? 'variant-solid ' + deviceBgColorClass : 'variant-outline'}">
                                <i data-lucide="${device.icon}" class="w-5 h-5 ${deviceIconColorClass}"></i>
                            </div>
                            <span class="device-tooltip text-xs">${device.tooltip}</span>
                        </div>
                    `;
                }).join('')}
            </div>`;
        }

        let quickActionsHtml = '';
        if (tile.quick_actions && tile.quick_actions.length > 0) {
            quickActionsHtml = `<div class="mt-6 grid grid-cols-2 gap-2">
                ${tile.quick_actions.map(action => {
                    // AssistantButton has text, icon, style, assistant_request
                    const text = action.text;
                    const icon = action.icon ? `<i data-lucide="${action.icon}" class="w-3 h-3 mr-1"></i>` : '';
                    return `<button class="glass-button text-xs px-3 py-1.5 rounded-lg text-white flex items-center justify-center">${icon}${text}</button>`;
                }).join('')}
            </div>`;
        }

        tileElement.innerHTML = `
            <div>
                <div class="flex justify-between items-start">
                    <h2 class="text-xl font-semibold text-white">${tile.title}</h2>
                    <i data-lucide="${tile.icon}" class="w-6 h-6 ${statusIconColorClass}"></i>
                </div>
                <p class="text-sm text-gray-300 mt-1">${tile.subtitle}</p>
                ${devicesHtml}
            </div>
            ${quickActionsHtml}
        `;
        
        // Add event listeners for tile quick_actions if they exist
        if (tile.quick_actions && tile.quick_actions.length > 0) {
            setTimeout(() => {
                const actionButtons = tileElement.querySelectorAll('.glass-button');
                actionButtons.forEach((btn, index) => {
                    const action = tile.quick_actions[index];
                    btn.onclick = async (e) => {
                        e.stopPropagation();
                        
                        // Check if it's AssistantButton with assistant_request
                        if (action.assistant_request) {
                            try {
                                const response = await fetch('/api/dashboard/action/', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        user_name: 'Niko',
                                        assistant_request: action.assistant_request
                                    })
                                });
                                
                                if (!response.ok) {
                                    throw new Error(`HTTP error! status: ${response.status}`);
                                }
                                
                                const updatedDashboard = await response.json();
                                console.log('Dashboard updated from tile quick action:', updatedDashboard);
                                
                                renderDashboardGrid(updatedDashboard);
                                lucide.createIcons();
                                
                            } catch (error) {
                                console.error('Failed to execute tile quick action:', error);
                                alert('Ошибка при выполнении запроса');
                            }
                        }
                    };
                });
            }, 0);
        }
        
        dashboardTilesContainer.appendChild(tileElement);
    });
}
