// Рендеринг ЛЕВОЙ боковой панели ("Арчи")
function renderLeftSidebar() {
    leftSidebarCollapsedIcons.innerHTML = '';
    leftSidebarExpandedMenu.innerHTML = '';

    // Иконка профиля (аватар с буквой)
    const userName = window.CURRENT_USER_NAME || '';
    const avatarLetter = userName.trim().charAt(0).toUpperCase() || '?';

    const avatarStyle = 'display:flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;border-radius:50%;background:rgba(0,191,255,0.2);border:1px solid rgba(0,191,255,0.4);color:#00bfff;font-weight:600;font-size:0.95rem;flex-shrink:0;cursor:pointer;';

    // Collapsed: круглый аватар, по клику — попап с выходом
    const profileCollapsed = document.createElement('div');
    profileCollapsed.className = 'sidebar-item';
    profileCollapsed.title = userName || 'Профиль';
    profileCollapsed.style.cssText = 'position:relative;';
    profileCollapsed.innerHTML = `<span style="${avatarStyle}">${avatarLetter}</span>`;
    profileCollapsed.onclick = (e) => {
        e.stopPropagation();
        const existing = document.getElementById('profile-popup-collapsed');
        if (existing) { existing.remove(); return; }
        const popup = document.createElement('div');
        popup.id = 'profile-popup-collapsed';
        popup.style.cssText = 'position:absolute;left:4rem;top:0;z-index:100;background:rgba(15,15,20,0.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);border-radius:0.75rem;padding:0.5rem;min-width:10rem;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
        popup.innerHTML = `
            <div style="padding:0.5rem 0.75rem;color:#9ca3af;font-size:0.75rem;font-weight:500;">${userName}</div>
            <hr style="border-color:rgba(255,255,255,0.1);margin:0.25rem 0;">
            <form method="post" action="/logout/" style="margin:0;">
                <input type="hidden" name="csrfmiddlewaretoken" value="${getCookie('csrftoken')}">
                <button type="submit" style="display:flex;align-items:center;gap:0.5rem;width:100%;padding:0.5rem 0.75rem;background:none;border:none;color:#f87171;font-size:0.875rem;cursor:pointer;border-radius:0.5rem;font-family:inherit;" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='none'">
                    <i data-lucide="log-out" style="width:1rem;height:1rem;"></i> Выйти
                </button>
            </form>
        `;
        profileCollapsed.appendChild(popup);
        lucide.createIcons({ nodes: [popup] });
        const closePopup = (ev) => { if (!profileCollapsed.contains(ev.target)) { popup.remove(); document.removeEventListener('click', closePopup); } };
        setTimeout(() => document.addEventListener('click', closePopup), 0);
    };
    leftSidebarCollapsedIcons.appendChild(profileCollapsed);

    // Expanded: аватар + имя + кнопка logout
    const profileExpanded = document.createElement('div');
    profileExpanded.className = 'sidebar-item-expanded';
    profileExpanded.style.cssText = 'justify-content:space-between;';
    profileExpanded.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.75rem;overflow:hidden;">
            <span style="${avatarStyle}">${avatarLetter}</span>
            <span class="sidebar-text" style="font-size:0.875rem;font-weight:500;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userName}</span>
        </div>
        <form method="post" action="/logout/" style="margin:0;flex-shrink:0;">
            <input type="hidden" name="csrfmiddlewaretoken" value="${getCookie('csrftoken')}">
            <button type="submit" class="sidebar-text" title="Выйти" style="background:none;border:none;padding:0.25rem;cursor:pointer;color:#6b7280;display:flex;align-items:center;" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#6b7280'">
                <i data-lucide="log-out" style="width:1rem;height:1rem;"></i>
            </button>
        </form>
    `;
    leftSidebarExpandedMenu.appendChild(profileExpanded);

    // Разделитель после профиля
    const hr1c = document.createElement('hr'); hr1c.className = 'border-t border-white/10 my-2'; leftSidebarCollapsedIcons.appendChild(hr1c);
    const hr1e = document.createElement('hr'); hr1e.className = 'border-t border-white/10 my-2'; leftSidebarExpandedMenu.appendChild(hr1e);

    // Кнопка "Новый чат"
    const newChatCollapsed = document.createElement('a');
    newChatCollapsed.href = "#";
    newChatCollapsed.className = "sidebar-item text-gray-300";
    newChatCollapsed.title = "Новый чат";
    newChatCollapsed.onclick = (e) => {
        e.preventDefault();
        // Простое создание нового чата через API
        fetch('/ai-assistant/api/conversations/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).then(response => response.json())
          .then(newChat => {
              console.log('New chat created:', newChat);
              loadChats(); // Перезагрузить список
              if (window.chatAssistantAPI) {
                  window.chatAssistantAPI.selectConversation(newChat.conversation_id);
              }
          }).catch(error => console.error('Error creating chat:', error));
    };
    newChatCollapsed.innerHTML = `<i data-lucide="plus-circle" class="w-6 h-6"></i>`;
    leftSidebarCollapsedIcons.appendChild(newChatCollapsed);

    // Кнопка "Предыдущее сообщение" (только в свернутом виде)
    const prevMessageBtn = document.createElement('button');
    prevMessageBtn.id = 'prev-message-btn';
    prevMessageBtn.className = "sidebar-item text-gray-400";
    prevMessageBtn.title = "Предыдущее сообщение";
    prevMessageBtn.onclick = () => {
        if (window.chatAssistantAPI) {
            window.chatAssistantAPI.navigateMessages('prev');
        }
    };
    prevMessageBtn.innerHTML = `<i data-lucide="chevron-up" class="w-6 h-6"></i>`;
    leftSidebarCollapsedIcons.appendChild(prevMessageBtn);

    // Кнопка "Следующее сообщение" (только в свернутом виде)
    const nextMessageBtn = document.createElement('button');
    nextMessageBtn.id = 'next-message-btn';
    nextMessageBtn.className = "sidebar-item text-gray-400";
    nextMessageBtn.title = "Следующее сообщение";
    nextMessageBtn.onclick = () => {
        if (window.chatAssistantAPI) {
            window.chatAssistantAPI.navigateMessages('next');
        }
    };
    nextMessageBtn.innerHTML = `<i data-lucide="chevron-down" class="w-6 h-6"></i>`;
    leftSidebarCollapsedIcons.appendChild(nextMessageBtn);

    const newChatExpanded = document.createElement('a');
    newChatExpanded.href = "#";
    newChatExpanded.className = "sidebar-item-expanded text-gray-300";
    newChatExpanded.onclick = (e) => {
        e.preventDefault();
        // Простое создание нового чата через API
        fetch('/ai-assistant/api/conversations/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).then(response => response.json())
          .then(newChat => {
              console.log('New chat created:', newChat);
              loadChats(); // Перезагрузить список
              if (window.chatAssistantAPI) {
                  window.chatAssistantAPI.selectConversation(newChat.conversation_id);
              }
          }).catch(error => console.error('Error creating chat:', error));
    };
    newChatExpanded.innerHTML = `<i data-lucide="plus-circle" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Новый чат</span>`;
    leftSidebarExpandedMenu.appendChild(newChatExpanded);

    // Разделитель только в развернутом виде
    const hr2e = document.createElement('hr'); hr2e.className = 'border-t border-white/10 my-2'; leftSidebarExpandedMenu.appendChild(hr2e);

    // Список чатов (только в развернутом виде)
    const chatsContainerExpanded = document.createElement('div');
    chatsContainerExpanded.id = 'chats-container-expanded';
    chatsContainerExpanded.className = 'flex-1 overflow-y-auto space-y-1';
    chatsContainerExpanded.style.maxHeight = 'calc(100vh - 300px)'; // Ограничиваем высоту
    leftSidebarExpandedMenu.appendChild(chatsContainerExpanded);

    // Разделитель внизу только в развернутом виде
    const hr3e = document.createElement('hr'); hr3e.className = 'border-t border-white/10 my-2'; leftSidebarExpandedMenu.appendChild(hr3e);

    // Кнопка "Поиск"
    const searchCollapsed = document.createElement('a');
    searchCollapsed.href = "#";
    searchCollapsed.className = "sidebar-item text-gray-300";
    searchCollapsed.title = "Поиск";
    searchCollapsed.innerHTML = `<i data-lucide="search" class="w-6 h-6"></i>`;
    leftSidebarCollapsedIcons.appendChild(searchCollapsed);

    const searchExpanded = document.createElement('a');
    searchExpanded.href = "#";
    searchExpanded.className = "sidebar-item-expanded text-gray-300";
    searchExpanded.innerHTML = `<i data-lucide="search" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Поиск</span>`;
    leftSidebarExpandedMenu.appendChild(searchExpanded);

    // Кнопка "Настройки чата"
    const settingsCollapsed = document.createElement('a');
    settingsCollapsed.href = "#";
    settingsCollapsed.className = "sidebar-item text-gray-300";
    settingsCollapsed.title = "Настройки ассистента";
    settingsCollapsed.onclick = (e) => {
        e.preventDefault();
        openChatSettingsModal();
    };
    settingsCollapsed.innerHTML = `<i data-lucide="sliders-horizontal" class="w-6 h-6"></i>`;
    leftSidebarCollapsedIcons.appendChild(settingsCollapsed);

    const settingsExpanded = document.createElement('a');
    settingsExpanded.href = "#";
    settingsExpanded.className = "sidebar-item-expanded text-gray-300";
    settingsExpanded.onclick = (e) => {
        e.preventDefault();
        openChatSettingsModal();
    };
    settingsExpanded.innerHTML = `<i data-lucide="sliders-horizontal" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Настройки ассистента</span>`;
    leftSidebarExpandedMenu.appendChild(settingsExpanded);

    renderSpotifyConnectItem(leftSidebarCollapsedIcons, leftSidebarExpandedMenu);
}

// Кнопка "Подключить Spotify" (видна только пока аккаунт не привязан)
async function renderSpotifyConnectItem(collapsedContainer, expandedContainer) {
    try {
        const response = await fetch('/spotify/api/status/');
        const data = await response.json();
        if (data.connected) return;
    } catch (error) {
        console.error('Error fetching Spotify status:', error);
        return;
    }

    const spotifyCollapsed = document.createElement('a');
    spotifyCollapsed.href = "/spotify/authorize/";
    spotifyCollapsed.className = "sidebar-item text-gray-300";
    spotifyCollapsed.title = "Подключить Spotify";
    spotifyCollapsed.innerHTML = `<i data-lucide="music" class="w-6 h-6"></i>`;
    collapsedContainer.appendChild(spotifyCollapsed);

    const spotifyExpanded = document.createElement('a');
    spotifyExpanded.href = "/spotify/authorize/";
    spotifyExpanded.className = "sidebar-item-expanded text-gray-300";
    spotifyExpanded.innerHTML = `<i data-lucide="music" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Подключить Spotify</span>`;
    expandedContainer.appendChild(spotifyExpanded);

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Простая загрузка чатов
async function loadChats() {
    try {
        const response = await fetch('/ai-assistant/api/conversations/');
        if (response.ok) {
            const conversations = await response.json();
            console.log('Chats loaded:', conversations);
            
            // Сортируем по дате (новые сверху)
            conversations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            renderChatsInSidebar(conversations);
        } else {
            console.error('Failed to load chats:', response.status);
        }
    } catch (error) {
        console.error('Error loading chats:', error);
    }
}

// Простой рендеринг чатов в сайдбаре
function renderChatsInSidebar(conversations) {
    const chatsContainer = document.getElementById('chats-container-expanded');
    if (!chatsContainer) return;

    chatsContainer.innerHTML = '';

    if (!conversations || conversations.length === 0) {
        chatsContainer.innerHTML = '<div class="text-gray-500 text-sm p-3 text-center">Нет чатов</div>';
        return;
    }

    conversations.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'relative group';
        
        const chatLink = document.createElement('a');
        chatLink.href = "#";
        chatLink.className = 'chat-item text-gray-300 pr-8 block cursor-pointer';
        chatLink.onclick = (e) => {
            e.preventDefault();
            if (window.chatAssistantAPI) {
                window.chatAssistantAPI.selectConversation(chat.conversation_id);
            }
        };
        
        // Простое отображение с title и датой
        const title = chat.title && chat.title !== 'New Conversation' 
            ? chat.title 
            : 'Новый чат';
        const displayTitle = title.length > 25 ? title.substring(0, 25) + '...' : title;
        const dateDisplay = formatChatDate(chat.created_at);
        
        chatLink.innerHTML = `
            <div class="flex items-start">
                <i data-lucide="message-circle" class="w-4 h-4 flex-shrink-0 text-gray-400 mt-1"></i>
                <div class="ml-3 flex-1 min-w-0">
                    <div class="font-medium text-sm text-white truncate">${displayTitle}</div>
                    <div class="text-xs text-gray-500 truncate">${dateDisplay}</div>
                </div>
            </div>
        `;
        
        // Кнопка удаления
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'absolute right-2 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300';
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Удалить чат "${title}"?`)) {
                try {
                    await fetch(`/ai-assistant/api/conversations/${chat.conversation_id}/`, {
                        method: 'DELETE'
                    });
                    loadChats(); // Перезагрузить список
                } catch (error) {
                    console.error('Failed to delete chat:', error);
                }
            }
        };
        deleteBtn.innerHTML = '<i data-lucide="trash-2" class="w-3 h-3"></i>';
        
        chatItem.appendChild(chatLink);
        chatItem.appendChild(deleteBtn);
        chatsContainer.appendChild(chatItem);
    });

    // Обновить иконки
    lucide.createIcons();
}

// Рендеринг ПРАВОЙ боковой панели ("Дом")
function renderRightSidebar() {
    rightSidebarCollapsedIcons.innerHTML = '';
    rightSidebarExpandedMenu.innerHTML = '';

    const homeCollapsed = document.createElement('a');
    homeCollapsed.href = "#";
    homeCollapsed.className = "sidebar-item text-gray-300";
    homeCollapsed.dataset.appCategory = 'home';
    homeCollapsed.title = "Главная";
    homeCollapsed.innerHTML = `<i data-lucide="layout-grid" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(homeCollapsed);

    const homeExpanded = document.createElement('a');
    homeExpanded.href = "#";
    homeExpanded.className = "sidebar-item-expanded text-gray-300";
    homeExpanded.dataset.appCategory = 'home';
    homeExpanded.innerHTML = `<i data-lucide="layout-grid" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Главная</span>`;
    rightSidebarExpandedMenu.appendChild(homeExpanded);

    const archieCollapsed = document.createElement('a');
    archieCollapsed.href = "#";
    archieCollapsed.className = "sidebar-item text-gray-300 active"; // Archie активен по умолч.
    archieCollapsed.dataset.appCategory = 'archie';
    archieCollapsed.title = "Archie Чат";
    archieCollapsed.innerHTML = `<i data-lucide="brain" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(archieCollapsed);

    const archieExpanded = document.createElement('a');
    archieExpanded.href = "#";
    archieExpanded.className = "sidebar-item-expanded text-gray-300 active";
    archieExpanded.dataset.appCategory = 'archie';
    archieExpanded.innerHTML = `<i data-lucide="brain" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Archie Чат</span>`;
    rightSidebarExpandedMenu.appendChild(archieExpanded);

    const voiceCollapsed = document.createElement('a');
    voiceCollapsed.href = "#";
    voiceCollapsed.className = "sidebar-item text-gray-300";
    voiceCollapsed.dataset.appCategory = 'voice';
    voiceCollapsed.title = "Voice Chat";
    voiceCollapsed.innerHTML = `<i data-lucide="audio-lines" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(voiceCollapsed);

    const voiceExpanded = document.createElement('a');
    voiceExpanded.href = "#";
    voiceExpanded.className = "sidebar-item-expanded text-gray-300";
    voiceExpanded.dataset.appCategory = 'voice';
    voiceExpanded.innerHTML = `<i data-lucide="audio-lines" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Voice Chat</span>`;
    rightSidebarExpandedMenu.appendChild(voiceExpanded);

    const swarmCollapsed = document.createElement('a');
    swarmCollapsed.href = "#";
    swarmCollapsed.className = "sidebar-item text-gray-300";
    swarmCollapsed.dataset.appCategory = 'swarm';
    swarmCollapsed.title = "Рой агентов";
    swarmCollapsed.innerHTML = `<i data-lucide="messages-square" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(swarmCollapsed);

    const swarmExpanded = document.createElement('a');
    swarmExpanded.href = "#";
    swarmExpanded.className = "sidebar-item-expanded text-gray-300";
    swarmExpanded.dataset.appCategory = 'swarm';
    swarmExpanded.innerHTML = `<i data-lucide="messages-square" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Рой агентов</span>`;
    rightSidebarExpandedMenu.appendChild(swarmExpanded);

    const promptsCollapsed = document.createElement('a');
    promptsCollapsed.href = "#";
    promptsCollapsed.className = "sidebar-item text-gray-300";
    promptsCollapsed.dataset.appCategory = 'prompts';
    promptsCollapsed.title = "Промпты";
    promptsCollapsed.innerHTML = `<i data-lucide="flask-conical" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(promptsCollapsed);

    const promptsExpanded = document.createElement('a');
    promptsExpanded.href = "#";
    promptsExpanded.className = "sidebar-item-expanded text-gray-300";
    promptsExpanded.dataset.appCategory = 'prompts';
    promptsExpanded.innerHTML = `<i data-lucide="flask-conical" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Промпты</span>`;
    rightSidebarExpandedMenu.appendChild(promptsExpanded);

    const monitoringCollapsed = document.createElement('a');
    monitoringCollapsed.href = "#";
    monitoringCollapsed.className = "sidebar-item text-gray-300";
    monitoringCollapsed.dataset.appCategory = 'monitoring';
    monitoringCollapsed.title = "Мониторинг чатов";
    monitoringCollapsed.innerHTML = `<i data-lucide="shield-check" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(monitoringCollapsed);

    const monitoringExpanded = document.createElement('a');
    monitoringExpanded.href = "#";
    monitoringExpanded.className = "sidebar-item-expanded text-gray-300";
    monitoringExpanded.dataset.appCategory = 'monitoring';
    monitoringExpanded.innerHTML = `<i data-lucide="shield-check" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Мониторинг чатов</span>`;
    rightSidebarExpandedMenu.appendChild(monitoringExpanded);

    rightSidebarCollapsedIcons.innerHTML += '<hr class="border-t border-white/10 my-2">';
    rightSidebarExpandedMenu.innerHTML += '<hr class="border-t border-white/10 my-2">';

    // Convert dashboard structure to array for rendering
    const tiles = [
        { ...dashboardData.light, category: 'light' },
        { ...dashboardData.climate, category: 'climate' },
        { ...dashboardData.music, category: 'music' },
        { ...dashboardData.documents, category: 'documents' },
        { ...dashboardData.apps, category: 'apps' },
        { ...dashboardData.settings, category: 'settings' }
    ];

    tiles.forEach(tile => {
        const iconColorClass = getTailwindColorClass(tile.status_color);
        
        const collapsedItem = document.createElement('a');
        collapsedItem.href = "#";
        collapsedItem.className = `sidebar-item ${iconColorClass}`;
        collapsedItem.dataset.appCategory = tile.category;
        collapsedItem.title = tile.title;
        collapsedItem.innerHTML = `<i data-lucide="${tile.icon}" class="w-6 h-6"></i>`;
        
        // Handle widget clicks for light and climate
        collapsedItem.onclick = (e) => {
            e.preventDefault();
            if (tile.category === 'light' || tile.category === 'climate') {
                if (typeof showWidgetView === 'function') {
                    showWidgetView(tile.category);
                }
            } else {
                console.log('Tile icon clicked (reserved for future):', tile.category);
            }
        };
        
        rightSidebarCollapsedIcons.appendChild(collapsedItem);

        const expandedItem = document.createElement('a');
        expandedItem.href = "#";
        expandedItem.className = `sidebar-item-expanded text-gray-300`;
        expandedItem.dataset.appCategory = tile.category;
        expandedItem.innerHTML = `<i data-lucide="${tile.icon}" class="w-5 h-5 flex-shrink-0 ${iconColorClass}"></i><span class="sidebar-text ml-4 font-medium">${tile.title}</span>`;
        
        // Handle widget clicks for light and climate
        expandedItem.onclick = (e) => {
            e.preventDefault();
            if (tile.category === 'light' || tile.category === 'climate') {
                if (typeof showWidgetView === 'function') {
                    showWidgetView(tile.category);
                }
            } else {
                console.log('Tile icon clicked (reserved for future):', tile.category);
            }
        };
        
        rightSidebarExpandedMenu.appendChild(expandedItem);
    });

    // Разделитель перед настройками профиля
    rightSidebarCollapsedIcons.innerHTML += '<hr class="border-t border-white/10 my-2">';
    rightSidebarExpandedMenu.innerHTML += '<hr class="border-t border-white/10 my-2">';

    // Кнопка "Настройки профиля"
    const profileSettingsCollapsed = document.createElement('a');
    profileSettingsCollapsed.href = "#";
    profileSettingsCollapsed.className = "sidebar-item text-gray-300";
    profileSettingsCollapsed.title = "Настройки профиля";
    profileSettingsCollapsed.onclick = (e) => {
        e.preventDefault();
        openUserProfileModal();
    };
    profileSettingsCollapsed.innerHTML = `<i data-lucide="user-cog" class="w-6 h-6"></i>`;
    rightSidebarCollapsedIcons.appendChild(profileSettingsCollapsed);

    const profileSettingsExpanded = document.createElement('a');
    profileSettingsExpanded.href = "#";
    profileSettingsExpanded.className = "sidebar-item-expanded text-gray-300";
    profileSettingsExpanded.onclick = (e) => {
        e.preventDefault();
        openUserProfileModal();
    };
    profileSettingsExpanded.innerHTML = `<i data-lucide="user-cog" class="w-5 h-5 flex-shrink-0"></i><span class="sidebar-text ml-4 font-medium">Настройки профиля</span>`;
    rightSidebarExpandedMenu.appendChild(profileSettingsExpanded);
}

// Обновить активное состояние кнопок "Archie" / "Home"
function updateSidebarActiveState(activeCategory) {
    document.querySelectorAll('#right-sidebar a').forEach(el => {
        if (el.dataset.appCategory === activeCategory) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

// Обновить состояние кнопок навигации по сообщениям
function updateMessageNavigationButtons(currentIndex, totalMessages) {
    const prevBtn = document.getElementById('prev-message-btn');
    const nextBtn = document.getElementById('next-message-btn');
    
    if (!prevBtn || !nextBtn) return;

    // Кнопки видны только в свернутом состоянии левого сайдбара
    if (isLeftSidebarExpanded) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        return;
    } else {
        prevBtn.style.display = 'flex';
        nextBtn.style.display = 'flex';
    }

    // Предыдущее сообщение доступно если индекс > 0
    if (currentIndex <= 0) {
        prevBtn.classList.add('opacity-30', 'cursor-not-allowed');
        prevBtn.classList.remove('text-gray-400');
        prevBtn.classList.add('text-gray-600');
        prevBtn.disabled = true;
    } else {
        prevBtn.classList.remove('opacity-30', 'cursor-not-allowed', 'text-gray-600');
        prevBtn.classList.add('text-gray-400');
        prevBtn.disabled = false;
    }

    // Следующее сообщение доступно если индекс < total - 1
    if (currentIndex >= totalMessages - 1) {
        nextBtn.classList.add('opacity-30', 'cursor-not-allowed');
        nextBtn.classList.remove('text-gray-400');
        nextBtn.classList.add('text-gray-600');
        nextBtn.disabled = true;
    } else {
        nextBtn.classList.remove('opacity-30', 'cursor-not-allowed', 'text-gray-600');
        nextBtn.classList.add('text-gray-400');
        nextBtn.disabled = false;
    }
}

// Свернуть/Развернуть ЛЕВУЮ панель
function toggleLeftSidebar(forceCollapse = false) {
    isLeftSidebarExpanded = !isLeftSidebarExpanded;
    if (forceCollapse) isLeftSidebarExpanded = false;

    // Экспортируем состояние для React компонента
    window.isLeftSidebarExpanded = isLeftSidebarExpanded;

    if (isLeftSidebarExpanded) {
        leftSidebar.classList.remove('w-20');
        leftSidebar.classList.add('w-72');
        mainContentArea.style.marginLeft = '0'; // Убираем margin
        leftSidebarCollapsedIcons.classList.add('hidden');
        leftSidebarExpandedMenu.classList.remove('hidden');
        leftSidebarToggleBtn.innerHTML = `<i data-lucide="chevron-left" class="w-6 h-6"></i>`;
        leftSidebarToggleBtn.title = "Свернуть панель";
        document.querySelectorAll('#left-sidebar .sidebar-text').forEach(el => el.style.opacity = '1');
        
        // Загружаем чаты при раскрытии панели
        loadChats();
    } else {
        leftSidebar.classList.add('w-20');
        leftSidebar.classList.remove('w-72');
        mainContentArea.style.marginLeft = '0'; // Убираем margin
        leftSidebarCollapsedIcons.classList.remove('hidden');
        leftSidebarExpandedMenu.classList.add('hidden');
        leftSidebarToggleBtn.innerHTML = `<i data-lucide="chevron-right" class="w-6 h-6"></i>`;
        leftSidebarToggleBtn.title = "Развернуть панель";
        document.querySelectorAll('#left-sidebar .sidebar-text').forEach(el => el.style.opacity = '0');
    }
    lucide.createIcons({
        nodes: [leftSidebarToggleBtn]
    });
    
    // Обновляем состояние кнопок навигации по сообщениям при переключении
    if (window.chatAssistantAPI && window.chatAssistantAPI.updateNavigationButtons) {
        window.chatAssistantAPI.updateNavigationButtons();
    }
}

// Свернуть/Развернуть ПРАВУЮ панель
function toggleRightSidebar(forceCollapse = false) {
    isRightSidebarExpanded = !isRightSidebarExpanded;
    if (forceCollapse) isRightSidebarExpanded = false;

    if (isRightSidebarExpanded) {
        rightSidebar.classList.remove('w-20');
        rightSidebar.classList.add('w-72');
        mainContentArea.style.marginRight = '0'; // Убираем margin
        rightSidebarCollapsedIcons.classList.add('hidden');
        rightSidebarExpandedMenu.classList.remove('hidden');
        rightSidebarToggleBtn.innerHTML = `<i data-lucide="chevron-right" class="w-6 h-6"></i>`;
        rightSidebarToggleBtn.title = "Свернуть панель";
        document.querySelectorAll('#right-sidebar .sidebar-text').forEach(el => el.style.opacity = '1');
    } else {
        rightSidebar.classList.add('w-20');
        rightSidebar.classList.remove('w-72');
        mainContentArea.style.marginRight = '0'; // Убираем margin
        rightSidebarCollapsedIcons.classList.remove('hidden');
        rightSidebarExpandedMenu.classList.add('hidden');
        rightSidebarToggleBtn.innerHTML = `<i data-lucide="chevron-left" class="w-6 h-6"></i>`;
        rightSidebarToggleBtn.title = "Развернуть панель";
        document.querySelectorAll('#right-sidebar .sidebar-text').forEach(el => el.style.opacity = '0');
    }
    lucide.createIcons({
        nodes: [rightSidebarToggleBtn]
    });
}

// ARCHIE-227: use the same stage eligibility in settings and the chat input.
function getAvailableModels(stage) {
    return Object.values(AI_MODELS).flat().filter(model =>
        AI_MODEL_CAPABILITIES[model]?.[stage] !== false
    );
}

function getModelPriceLabel(model) {
    const price = AI_MODEL_PRICES[model];
    return price ? `Base USD / 1M tokens: input $${price.input}, output $${price.output}` : model;
}

// Gen UI Level configuration
const GEN_UI_LEVELS = {
    1: {
        name: "Level 1",
        description: "Basic - All models, plain text only",
        modelProviders: ["openai", "openrouter"],
        showCommandModel: false,
        showFinalOutputModel: true,
        responseFormats: ["plain"],
        fixedFormat: "plain",
        defaults: {
            commandModel: "gpt-4.1",
            finalOutputModel: "gpt-4.1"
        }
    },
    2: {
        name: "Level 2",
        description: "Standard - Text + Quick Actions",
        modelProviders: ["openai", "openrouter"],
        showCommandModel: true,
        showFinalOutputModel: true,
        responseFormats: [],
        fixedFormat: "level2_answer",
        defaults: {
            commandModel: "gpt-4.1",
            finalOutputModel: "gpt-4.1"
        }
    },
    3: {
        name: "Level 3",
        description: "Enhanced - Text + Widget + Actions",
        modelProviders: ["openai", "openrouter"],
        showCommandModel: true,
        showFinalOutputModel: true,
        responseFormats: [],
        fixedFormat: "level3_answer",
        defaults: {
            commandModel: "gpt-4.1",
            finalOutputModel: "gpt-4.1"
        }
    },
    4: {
        name: "Level 4",
        description: "Advanced - All models, UI Answer",
        modelProviders: ["openai", "openrouter"],
        showCommandModel: true,
        showFinalOutputModel: true,
        responseFormats: ["ui_answer"],
        fixedFormat: "ui_answer",
        defaults: {
            commandModel: "gpt-4.1",
            finalOutputModel: "gpt-4.1"
        }
    },
    5: {
        name: "Level 5",
        description: "Coming soon ;)",
        modelProviders: ["openai", "openrouter"],
        showCommandModel: true,
        showFinalOutputModel: true,
        responseFormats: ["ui_answer"],
        fixedFormat: "ui_answer",
        comingSoon: true,
        defaults: {
            commandModel: "gpt-4.1",
            finalOutputModel: "gpt-4.1"
        }
    }
};

// Get selected Gen UI level from localStorage or default
function getSelectedGenUILevel() {
    return parseInt(localStorage.getItem('selectedGenUILevel')) || 4;
}

// Set selected Gen UI level in localStorage
function setSelectedGenUILevel(level) {
    localStorage.setItem('selectedGenUILevel', level);
    window.selectedGenUILevel = level;
    const config = GEN_UI_LEVELS[level];
    if (config && config.fixedFormat) {
        setSelectedResponseFormat(config.fixedFormat);
    }
}

// Available response formats
const RESPONSE_FORMATS = [
    { value: "auto", label: "Auto" },
    { value: "plain", label: "Plain Text" },
    { value: "markdown", label: "Markdown" },
    { value: "html", label: "HTML" },
    { value: "ssml", label: "SSML" },
    { value: "json", label: "JSON" },
    { value: "csv", label: "CSV" },
    { value: "xml", label: "XML" },
    { value: "yaml", label: "YAML" },
    { value: "prompt", label: "Prompt" },
    { value: "python", label: "Python" },
    { value: "bash", label: "Bash" },
    { value: "sql", label: "SQL" },
    { value: "regex", label: "Regex" },
    { value: "dockerfile", label: "Dockerfile" },
    { value: "makefile", label: "Makefile" },
    { value: "level2_answer", label: "Level 2 (Text + Buttons)" },
    { value: "level3_answer", label: "Level 3 (Text + Widget)" },
    { value: "ui_answer", label: "UI Answer" },
    { value: "dashboard", label: "Dashboard" },
    { value: "widget", label: "Widget" },
];

// Get selected command model from localStorage or default
function getSelectedCommandModel() {
    // ARCHIE-221: one-time switch of the old stored default gpt-4.1-mini to gpt-4.1
    if (!localStorage.getItem('commandModelDefaultMigrated')) {
        if (localStorage.getItem('selectedCommandModel') === 'gpt-4.1-mini') {
            localStorage.setItem('selectedCommandModel', 'gpt-4.1');
        }
        localStorage.setItem('commandModelDefaultMigrated', '1');
    }
    const stored = localStorage.getItem('selectedCommandModel');
    const model = getAvailableModels('command').includes(stored) ? stored : 'gpt-4.1';
    localStorage.setItem('selectedCommandModel', model);
    return model;
}

// Set selected command model in localStorage
function setSelectedCommandModel(model) {
    localStorage.setItem('selectedCommandModel', model);
    window.selectedCommandModel = model;
}

// Get selected final output model from localStorage or default
function getSelectedFinalOutputModel() {
    const stored = localStorage.getItem('selectedFinalOutputModel');
    const stage = ['auto', 'ui_answer', 'level2_answer', 'level3_answer', 'dashboard', 'widget'].includes(getSelectedResponseFormat()) ? 'final_ui' : 'final_plain';
    const model = getAvailableModels(stage).includes(stored) ? stored : 'gpt-4.1';
    localStorage.setItem('selectedFinalOutputModel', model);
    return model;
}

// Set selected final output model in localStorage
function setSelectedFinalOutputModel(model) {
    localStorage.setItem('selectedFinalOutputModel', model);
    window.selectedFinalOutputModel = model;
}

// Get selected response format from localStorage or default
function getSelectedResponseFormat() {
    return localStorage.getItem('selectedResponseFormat') || 'ui_answer';
}

// Set selected response format in localStorage
function setSelectedResponseFormat(format) {
    localStorage.setItem('selectedResponseFormat', format);
    window.selectedResponseFormat = format;
}

// Assistant character options (mirror UserProfile.PERSONA_CHOICES)
const ASSISTANT_PERSONAS = [
    { value: 'business', label: 'Business' },
    { value: 'bro', label: 'Bro' },
    { value: 'flirty', label: 'Flirty' },
    { value: 'futurebot', label: 'Futurebot' },
    { value: 'butler', label: 'Butler' },
];

// Open assistant settings modal
function openChatSettingsModal() {
    const currentLevel = getSelectedGenUILevel();
    let selectedLevel = currentLevel;
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 flex items-center justify-center z-50';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
    
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4 border border-white/20';
    modalContent.onclick = (e) => e.stopPropagation();
    
    const title = document.createElement('h2');
    title.className = 'text-xl font-bold text-white mb-6';
    title.textContent = 'Настройки ассистента';
    modalContent.appendChild(title);

    // Assistant character (persona) — first setting
    const personaSection = document.createElement('div');
    personaSection.className = 'mb-6';

    const personaLabel = document.createElement('label');
    personaLabel.className = 'block text-sm font-medium text-gray-300 mb-2';
    personaLabel.textContent = 'Характер ассистента';
    personaSection.appendChild(personaLabel);

    const personaSelect = document.createElement('select');
    personaSelect.className = 'w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-white/20 focus:border-blue-500 focus:outline-none';
    personaSelect.style.color = 'white';
    personaSelect.style.backgroundColor = '#1f2937';
    ASSISTANT_PERSONAS.forEach(p => {
        const option = document.createElement('option');
        option.value = p.value;
        option.textContent = p.label;
        option.style.backgroundColor = '#1f2937';
        option.style.color = 'white';
        personaSelect.appendChild(option);
    });
    personaSection.appendChild(personaSelect);
    modalContent.appendChild(personaSection);

    // Prefill the current persona from the profile (authoritative source)
    fetch('/api/profile/')
        .then(r => (r.ok ? r.json() : null))
        .then(p => { if (p && p.persona) personaSelect.value = p.persona; })
        .catch(() => {});

    // Gen UI Level selection section
    const levelSection = document.createElement('div');
    levelSection.className = 'mb-6';
    
    const levelLabel = document.createElement('label');
    levelLabel.className = 'block text-sm font-medium text-gray-300 mb-2';
    levelLabel.textContent = 'Gen UI Level';
    levelSection.appendChild(levelLabel);
    
    const levelSelect = document.createElement('select');
    levelSelect.className = 'w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-white/20 focus:border-blue-500 focus:outline-none';
    levelSelect.style.color = 'white';
    levelSelect.style.backgroundColor = '#1f2937';
    
    Object.entries(GEN_UI_LEVELS).forEach(([level, config]) => {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = `${config.name} - ${config.description}`;
        option.selected = parseInt(level) === currentLevel;
        option.style.backgroundColor = '#1f2937';
        option.style.color = 'white';
        if (config.comingSoon) {
            option.disabled = true;
            option.style.color = '#6b7280';
        }
        levelSelect.appendChild(option);
    });
    
    levelSection.appendChild(levelSelect);
    modalContent.appendChild(levelSection);
    
    // Update the selected level when it changes
    levelSelect.onchange = () => {
        selectedLevel = parseInt(levelSelect.value);
    };
    
    // Buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'flex gap-3';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium';
    saveBtn.textContent = 'Сохранить';
    saveBtn.onclick = async () => {
        setSelectedGenUILevel(selectedLevel);

        // Persist the assistant character to the profile (DB + Redis via signal)
        const persona = personaSelect.value;
        try {
            await fetch('/api/profile/update/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ persona })
            });
            window.selectedStyle = persona;
        } catch (error) {
            console.error('Failed to save assistant character:', error);
        }
        document.body.removeChild(modal);
    };
    buttonsContainer.appendChild(saveBtn);
    
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.onclick = () => document.body.removeChild(modal);
    buttonsContainer.appendChild(cancelBtn);
    
    modalContent.appendChild(buttonsContainer);
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
}

// Initialize selected models, response format, and Gen UI level on page load
window.selectedGenUILevel = getSelectedGenUILevel();
window.selectedCommandModel = getSelectedCommandModel();
window.selectedFinalOutputModel = getSelectedFinalOutputModel();
window.selectedResponseFormat = getSelectedResponseFormat();

// Open user profile settings modal
async function openUserProfileModal() {
    try {
        // Fetch profile data and choices in parallel
        const [profileResponse, choicesResponse] = await Promise.all([
            fetch('/api/profile/'),
            fetch('/api/profile/choices/')
        ]);

        if (!profileResponse.ok) {
            throw new Error('Failed to load profile');
        }

        const profile = await profileResponse.json();
        const choices = await choicesResponse.json();

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 flex items-center justify-center z-50';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };

        const modalContent = document.createElement('div');
        modalContent.className = 'bg-gray-900 rounded-2xl p-6 max-w-2xl w-full mx-4 border border-white/20 max-h-[90vh] overflow-y-auto';
        modalContent.onclick = (e) => e.stopPropagation();

        const title = document.createElement('h2');
        title.className = 'text-xl font-bold text-white mb-6';
        title.textContent = 'Настройки профиля';
        modalContent.appendChild(title);

        // Create form
        const form = document.createElement('form');
        form.className = 'space-y-4';

        // Basic Information Section
        form.innerHTML += '<h3 class="text-lg font-semibold text-white mt-4 mb-2">Основная информация</h3>';
        
        form.innerHTML += createFormField('user_name', 'Имя пользователя', 'text', profile.user_name);
        form.innerHTML += createFormSelect('persona', 'Персона', choices.persona, profile.persona);

        // Location & Time Section
        form.innerHTML += '<h3 class="text-lg font-semibold text-white mt-6 mb-2">Местоположение и время</h3>';
        
        form.innerHTML += createFormField('default_city', 'Город по умолчанию', 'text', profile.default_city);
        form.innerHTML += createFormField('default_country', 'Страна по умолчанию', 'text', profile.default_country);
        form.innerHTML += createFormField('user_timezone', 'Часовой пояс', 'text', profile.user_timezone);
        form.innerHTML += createFormField('measurement_units', 'Единицы измерения', 'text', profile.measurement_units);

        // Localization Section
        form.innerHTML += '<h3 class="text-lg font-semibold text-white mt-6 mb-2">Локализация</h3>';
        
        form.innerHTML += createFormSelect('currency', 'Валюта', choices.currency, profile.currency);
        form.innerHTML += createFormField('date_format', 'Формат даты', 'text', profile.date_format);
        form.innerHTML += createFormSelect('time_format', 'Формат времени', choices.time_format, profile.time_format);

        // Commercial Settings Section
        form.innerHTML += '<h3 class="text-lg font-semibold text-white mt-6 mb-2">Коммерческие настройки</h3>';
        
        form.innerHTML += createFormField('commercial_holidays', 'Регион праздников', 'text', profile.commercial_holidays);
        form.innerHTML += createFormCheckbox('commercial_check_open_now', 'Проверять время работы', profile.commercial_check_open_now);

        modalContent.appendChild(form);

        // Buttons
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'flex gap-3 mt-6';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium';
        saveBtn.textContent = 'Сохранить';
        saveBtn.onclick = async () => {
            try {
                const formData = new FormData(form);
                const data = {};
                
                for (let [key, value] of formData.entries()) {
                    if (key === 'commercial_check_open_now') {
                        data[key] = value === 'on';
                    } else {
                        data[key] = value;
                    }
                }

                const response = await fetch('/api/profile/update/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    console.log('Profile updated successfully');
                    document.body.removeChild(modal);
                } else {
                    const error = await response.json();
                    alert(`Ошибка: ${error.error || 'Не удалось сохранить профиль'}`);
                }
            } catch (err) {
                alert(`Ошибка: ${err.message}`);
            }
        };
        buttonsContainer.appendChild(saveBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.onclick = () => document.body.removeChild(modal);
        buttonsContainer.appendChild(cancelBtn);

        modalContent.appendChild(buttonsContainer);

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

    } catch (error) {
        console.error('Error loading profile:', error);
        alert('Не удалось загрузить профиль');
    }
}

// Helper function to create form field
function createFormField(name, label, type, value) {
    return `
        <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">${label}</label>
            <input type="${type}" name="${name}" value="${value || ''}" 
                   class="w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-white/20 focus:border-blue-500 focus:outline-none"
                   style="color: white; background-color: #1f2937;">
        </div>
    `;
}

// Helper function to create select field
function createFormSelect(name, label, options, selectedValue) {
    const optionsHtml = options.map(opt => 
        `<option value="${opt.value}" ${opt.value === selectedValue ? 'selected' : ''} 
                 style="background-color: #1f2937; color: white;">${opt.label}</option>`
    ).join('');
    
    return `
        <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">${label}</label>
            <select name="${name}" 
                    class="w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-white/20 focus:border-blue-500 focus:outline-none"
                    style="color: white; background-color: #1f2937;">
                ${optionsHtml}
            </select>
        </div>
    `;
}

// Helper function to create checkbox field
function createFormCheckbox(name, label, checked) {
    return `
        <div class="flex items-center">
            <input type="checkbox" name="${name}" ${checked ? 'checked' : ''} 
                   class="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500">
            <label class="ml-2 text-sm font-medium text-gray-300">${label}</label>
        </div>
    `;
}

// Helper function to get CSRF token
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
