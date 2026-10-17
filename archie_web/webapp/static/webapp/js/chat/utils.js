// AI-driven UI rendering helper functions
function getSpacingClass(spacing) {
    switch (spacing) {
        case 'tight': return 'space-y-2';
        case 'loose': return 'space-y-8';
        default: return 'space-y-4';
    }
}

function getButtonStyle(style) {
    switch (style) {
        case 'primary': return 'bg-indigo-600 hover:bg-indigo-500 text-white';
        case 'success': return 'bg-green-600 hover:bg-green-500 text-white';
        case 'warning': return 'bg-yellow-500 hover:bg-yellow-400 text-slate-900';
        case 'danger': return 'bg-red-600 hover:bg-red-500 text-white';
        default: return 'bg-slate-700 hover:bg-slate-600 text-white';
    }
}

function formatTime(dateString) {
    return new Date(dateString).toLocaleTimeString('ru-RU', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}
