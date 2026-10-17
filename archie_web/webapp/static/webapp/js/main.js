// --- Функции управления состоянием ---

// Показать "Чат"
function showChatView() {
    chatView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    widgetView.classList.add('hidden');
    if (voiceView) voiceView.classList.add('hidden');
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    leftSidebar.classList.remove('hidden'); // Показываем левый сайдбар в режиме чата
    updateSidebarActiveState('archie');

    // Stop dashboard polling when leaving dashboard
    if (typeof stopDashboardPolling === 'function') {
        stopDashboardPolling();
    }
}

// Показать "Дашборд"
function showDashboardView() {
    chatView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    widgetView.classList.add('hidden');
    if (voiceView) voiceView.classList.add('hidden');
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    leftSidebar.classList.add('hidden'); // Скрываем левый сайдбар в режиме дашборда
    updateSidebarActiveState('home');

    // Start dashboard polling when showing dashboard
    if (typeof startDashboardPolling === 'function') {
        startDashboardPolling(30000); // Poll every 30 seconds
    }
}

// Показать "Голосовой чат"
function showVoiceView() {
    chatView.classList.add('hidden');
    dashboardView.classList.add('hidden');
    widgetView.classList.add('hidden');
    voiceView.classList.remove('hidden');
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    document.body.classList.add('voice-mode'); // Прячем общий фоновый .orb
    leftSidebar.classList.add('hidden'); // Полноэкранный голосовой режим
    updateSidebarActiveState('voice');

    if (typeof stopDashboardPolling === 'function') {
        stopDashboardPolling();
    }
}

// Export view functions globally
window.showChatView = showChatView;
window.showDashboardView = showDashboardView;
window.showVoiceView = showVoiceView;

// --- Инициализация и обработчики событий ---
document.addEventListener('DOMContentLoaded', () => {
    // 0. Инициализация глобальных переменных
    leftSidebar = document.getElementById('left-sidebar');
    leftSidebarCollapsedIcons = document.getElementById('left-sidebar-collapsed-icons');
    leftSidebarExpandedMenu = document.getElementById('left-sidebar-expanded-menu');
    leftSidebarToggleBtn = document.getElementById('left-sidebar-toggle-btn');
    
    rightSidebar = document.getElementById('right-sidebar');
    rightSidebarCollapsedIcons = document.getElementById('right-sidebar-collapsed-icons');
    rightSidebarExpandedMenu = document.getElementById('right-sidebar-expanded-menu');
    rightSidebarToggleBtn = document.getElementById('right-sidebar-toggle-btn');
    
    mainContentArea = document.getElementById('main-content-area');
    chatView = document.getElementById('chat-view');
    dashboardView = document.getElementById('dashboard-view');
    widgetView = document.getElementById('widget-view');
    voiceView = document.getElementById('voice-view');
    
    globalQuickActionsContainer = document.getElementById('global-quick-actions');
    dashboardTilesContainer = document.getElementById('dashboard-tiles');

    // 1. Рендеринг всего
    renderLeftSidebar();
    renderRightSidebar();
    renderDashboardGrid();
    
    // 2. Инициализация иконок Lucide
    lucide.createIcons();

    // 3. Установка начального состояния
    showChatView(); // Показываем чат по умолчанию (левый сайдбар будет видим)
    // Устанавливаем иконки для кнопок сворачивания
    leftSidebarToggleBtn.innerHTML = `<i data-lucide="chevron-right" class="w-6 h-6"></i>`;
    rightSidebarToggleBtn.innerHTML = `<i data-lucide="chevron-left" class="w-6 h-6"></i>`;
    lucide.createIcons({ nodes: [leftSidebarToggleBtn, rightSidebarToggleBtn] });
    
    // Устанавливаем начальные отступы для контента
    mainContentArea.style.marginLeft = '0';
    mainContentArea.style.marginRight = '0';
    
    // Экспортируем начальное состояние для React компонента
    window.isLeftSidebarExpanded = isLeftSidebarExpanded;

    // 4. Обработчик клика на кнопку "Свернуть/Развернуть" (ЛЕВАЯ ПАНЕЛЬ)
    leftSidebarToggleBtn.addEventListener('click', () => toggleLeftSidebar());
    
    // 5. Обработчик клика на кнопку "Свернуть/Развернуть" (ПРАВАЯ ПАНЕЛЬ)
    rightSidebarToggleBtn.addEventListener('click', () => toggleRightSidebar());

    // 6. Обработчик кликов на элементы ПРАВОЙ ПАНЕЛИ (делегирование)
    rightSidebar.addEventListener('click', async (e) => {
        const link = e.target.closest('a');
        if (!link) return; 

        const category = link.dataset.appCategory;

        if (category === 'archie') {
            e.preventDefault();
            showChatView();
        } else if (category === 'voice') {
            e.preventDefault();
            showVoiceView();
        } else if (category === 'swarm') {
            e.preventDefault();
            showSwarmView();
        } else if (category === 'prompts') {
            e.preventDefault();
            showPromptsView();
        } else if (category === 'monitoring') {
            e.preventDefault();
            showMonitoringView();
        } else if (category === 'home') {
            e.preventDefault();
            
            // Show dashboard view - will trigger updateDashboard() via startDashboardPolling
            showDashboardView();
        } else if (category === 'light' || category === 'climate' || category === 'music' || category === 'documents') {
            e.preventDefault();
            console.log('Widget icon clicked:', category);
            if (typeof showWidgetView === 'function') {
                showWidgetView(category);
            }
        }

        // Сворачиваем, если была развернута
        if (isRightSidebarExpanded) {
            toggleRightSidebar(true); // force collapse
        }
    });
    
    // 7. Обработчики для сворачивания панелей (Escape и Клик)
    
    // Клик на центральный контент - сворачиваем только ПРАВЫЙ сайдбар
    mainContentArea.addEventListener('click', () => {
        if (isRightSidebarExpanded) {
            toggleRightSidebar(true); // force collapse
        }
    });

    // Нажатие Escape - сворачиваем только ПРАВЫЙ сайдбар
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (isRightSidebarExpanded) {
                toggleRightSidebar(true); // force collapse
            }
        }
    });

    // Обработчик изменения размера окна для адаптивной сетки
    window.addEventListener('resize', () => {
        // Перерендериваем дашборд при изменении ориентации
        if (!dashboardView.classList.contains('hidden')) {
            renderDashboardGrid();
        }
    });
});
