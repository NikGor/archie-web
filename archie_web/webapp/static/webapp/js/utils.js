// --- Вспомогательные функции ---

// (getTailwindColorClass и getTailwindBgColorClass)
function getTailwindColorClass(colorName, shade = 400) {
    const colorMap = { "gray": "gray", "green": "green", "blue": "blue", "orange": "orange", "yellow": "yellow", "red": "red", "purple": "purple" };
    return `text-${colorMap[colorName] || 'gray'}-${shade}`;
}
function getTailwindBgColorClass(colorName, shade = 600, opacity = 20) {
    const colorMap = { "gray": "gray", "green": "green", "blue": "blue", "orange": "orange", "yellow": "yellow", "red": "red", "purple": "purple" };
    return `bg-${colorMap[colorName] || 'gray'}-${shade}/${opacity}`;
}

// Функции для группировки чатов по датам
function getDateGroup(dateString) {
    const chatDate = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Начало текущей недели (понедельник)
    const currentWeekStart = new Date(today);
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Воскресенье = 0
    currentWeekStart.setDate(today.getDate() - daysToMonday);
    
    // Начало прошлой недели
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    
    // Начало текущего месяца
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    if (chatDate >= today) {
        return 'today';
    } else if (chatDate >= yesterday) {
        return 'yesterday';
    } else if (chatDate >= currentWeekStart) {
        return 'thisWeek';
    } else if (chatDate >= lastWeekStart) {
        return 'lastWeek';
    } else if (chatDate >= currentMonthStart) {
        return 'thisMonth';
    } else {
        return 'older';
    }
}

function getGroupTitle(groupKey) {
    const titles = {
        'today': 'Сегодня',
        'yesterday': 'Вчера',
        'thisWeek': 'На этой неделе',
        'lastWeek': 'На прошлой неделе',
        'thisMonth': 'В этом месяце',
        'older': 'Раньше'
    };
    return titles[groupKey] || 'Другое';
}

function groupChatsByDate(chats) {
    const groups = {
        'today': [],
        'yesterday': [],
        'thisWeek': [],
        'lastWeek': [],
        'thisMonth': [],
        'older': []
    };
    
    chats.forEach(chat => {
        const group = getDateGroup(chat.created_at);
        groups[group].push(chat);
    });
    
    // Возвращаем только группы с чатами
    const result = [];
    Object.keys(groups).forEach(groupKey => {
        if (groups[groupKey].length > 0) {
            result.push({
                key: groupKey,
                title: getGroupTitle(groupKey),
                chats: groups[groupKey]
            });
        }
    });
    
    return result;
}

function formatChatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date >= today) {
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } else if (date >= yesterday) {
        return 'Вчера';
    } else {
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }
}
