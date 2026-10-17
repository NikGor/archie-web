// Данные из JSON для дашборда (fallback если API недоступен)
const dashboardData = {
    "type": "dashboard",
    "light": {
        "type": "light",
        "title": "Light",
        "subtitle": "Loading…",
        "icon": "lightbulb",
        "status_color": "gray",
        "quick_actions": null,
        "devices": null
    },
    "climate": {
        "type": "climate",
        "title": "Climate",
        "subtitle": "Loading…",
        "icon": "thermometer",
        "status_color": "gray",
        "quick_actions": null,
        "devices": null
    },
    "music": {
        "type": "music",
        "title": "Music",
        "subtitle": "David Bowie – Space Oddity (1969)",
        "icon": "music",
        "status_color": "purple",
        "quick_actions": [
            { "type": "assistant_button", "text": "Evening Playlist", "style": "primary", "icon": "list-music", "assistant_request": "Включи вечерний плейлист" },
            { "type": "assistant_button", "text": "Album Details", "style": "secondary", "icon": "disc", "assistant_request": "Покажи детали альбома" }
        ],
        "devices": [
            { "name": "Pause", "icon": "pause", "color": "purple", "variant": "solid", "tooltip": "Pause playback" },
            { "name": "Next", "icon": "skip-forward", "color": "purple", "variant": "outline", "tooltip": "Next track" }
        ]
    },
    "documents": {
        "type": "documents",
        "title": "Documents",
        "subtitle": "new today: 2, source: Gmail",
        "icon": "file-search",
        "status_color": "blue",
        "quick_actions": [
            { "type": "assistant_button", "text": "Learn More", "style": "primary", "icon": "graduation-cap", "assistant_request": "Расскажи подробнее о новых документах" },
            { "type": "assistant_button", "text": "Find Document", "style": "secondary", "icon": "search", "assistant_request": "Найди документ" }
        ],
        "devices": null
    },
    "apps": {
        "type": "apps",
        "title": "Apps",
        "subtitle": "AI-generated utilities",
        "icon": "grid-3x3",
        "status_color": "green",
        "quick_actions": [
            { "type": "assistant_button", "text": "Start Pomodoro", "style": "primary", "icon": "timer", "assistant_request": "Запусти помодоро таймер" },
            { "type": "assistant_button", "text": "Markdown Render", "style": "secondary", "icon": "file-code", "assistant_request": "Открой markdown редактор" }
        ],
        "devices": null
    },
    "settings": {
        "type": "settings",
        "title": "Settings",
        "subtitle": "Configuration",
        "icon": "settings",
        "status_color": "gray",
        "quick_actions": [
            { "type": "assistant_button", "text": "Open Settings", "style": "primary", "icon": "settings-2", "assistant_request": "Открой настройки" },
            { "type": "assistant_button", "text": "Profile", "style": "secondary", "icon": "user", "assistant_request": "Покажи профиль" }
        ],
        "devices": null
    },
    "quick_actions": [
        { "type": "assistant_button", "text": "Create a jazz bar vibe", "style": "primary", "icon": "music", "assistant_request": "Создать атмосферу джазового бара" },
        { "type": "assistant_button", "text": "Plan tomorrow", "style": "secondary", "icon": "calendar-days", "assistant_request": "Помоги спланировать завтрашний день" },
        { "type": "assistant_button", "text": "Football scores today", "style": "secondary", "icon": "trophy", "assistant_request": "Покажи результаты футбольных матчей сегодня" }
    ]
};

// Export to window for global access
window.dashboardData = dashboardData;
