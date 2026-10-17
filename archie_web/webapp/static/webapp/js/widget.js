// Light Widget API Functions — display-only, state read live from Home Assistant

async function fetchLightWidgetData() {
    try {
        const response = await fetch('/light/api/widget/status/');
        const data = await response.json();
        if (data.success) {
            return data;
        }
        console.error('Failed to fetch light widget data:', data.message);
        return null;
    } catch (error) {
        console.error('Error fetching light widget data:', error);
        return null;
    }
}

async function buildLightWidgetData() {
    const data = await fetchLightWidgetData();
    return data || STATIC_LIGHT_WIDGET;
}

// Static fallback data for Light widget (used when API unavailable)
const STATIC_LIGHT_WIDGET = {
    type: "light_widget",
    title: "Light",
    subtitle: "Loading...",
    on_count: 0,
    total_count: 0,
    devices: [],
    sensors: [],
    quick_actions: [
        {
            type: "assistant_button",
            text: "Turn on all",
            style: "primary",
            icon: "power",
            assistant_request: "Включи весь свет"
        },
        {
            type: "assistant_button",
            text: "Turn off all",
            style: "secondary",
            icon: "power-off",
            assistant_request: "Выключи весь свет"
        }
    ]
};

const STATIC_CLIMATE_WIDGET = {
    type: "climate_widget",
    title: "Climate",
    subtitle: "average 21.8°C, humidity 48%",
    average_temp: 21.8,
    average_humidity: 48,
    radiators: [
        {
            device_id: "radiator_1",
            name: "Living room radiator",
            room: "Living room",
            is_on: true,
            target_temp: 22.0,
            current_temp: 22.1,
            mode: "heat",
            icon: "heater",
            color: "red"
        },
        {
            device_id: "radiator_2",
            name: "Bedroom radiator",
            room: "Bedroom",
            is_on: false,
            target_temp: 20.0,
            current_temp: 21.5,
            mode: "off",
            icon: "heater",
            color: "blue"
        }
    ],
    sensors: [
        {
            device_id: "sensor_1",
            name: "Living room sensor",
            room: "Living room",
            temperature: 22.1,
            humidity: 45,
            battery_level: 87,
            last_updated: "2 min ago",
            icon: "thermometer",
            color: "green"
        },
        {
            device_id: "sensor_2",
            name: "Bedroom sensor",
            room: "Bedroom",
            temperature: 21.5,
            humidity: 51,
            battery_level: 62,
            last_updated: "5 min ago",
            icon: "thermometer",
            color: "green"
        }
    ],
    quick_actions: [
        {
            type: "assistant_button",
            text: "Eco mode",
            style: "primary",
            icon: "leaf",
            assistant_request: "Включи эко режим отопления"
        },
        {
            type: "assistant_button",
            text: "Warm up home",
            style: "secondary",
            icon: "flame",
            assistant_request: "Прогрей весь дом до 23 градусов"
        }
    ]
};

async function fetchClimateWidgetData() {
    try {
        const response = await fetch('/climate/api/devices/status/');
        const data = await response.json();
        if (data.success) {
            return data;
        }
        console.error('Failed to fetch climate data:', data.message);
        return null;
    } catch (error) {
        console.error('Error fetching climate data:', error);
        return null;
    }
}

async function buildClimateWidgetData() {
    const data = await fetchClimateWidgetData();
    return data || STATIC_CLIMATE_WIDGET;
}

const MUSIC_REPEAT_CYCLE = { off: 'context', context: 'track', track: 'off' };
// Must match .vinyl-disc's `animation: vinyl-spin <duration>` in custom.css.
// Re-renders (polling, SDK events) rebuild the disc element from scratch,
// which would otherwise snap its rotation back to 0deg every time; using a
// clock-derived negative animation-delay keeps the spin visually continuous.
const VINYL_SPIN_DURATION_MS = 9000;

const MUSIC_QUICK_ACTIONS = [
    {
        type: "assistant_button",
        text: "Мои плейлисты",
        style: "primary",
        icon: "list-music",
        assistant_request: "Покажи мои плейлисты"
    },
    {
        type: "assistant_button",
        text: "Рекомендации",
        style: "secondary",
        icon: "sparkles",
        assistant_request: "Порекомендуй музыку похожую на текущий трек"
    }
];

function musicSubtitleFor(playback) {
    return playback && playback.current_track
        ? `Воспроизводится: ${playback.current_track.artist} — ${playback.current_track.title}`
        : "Ничего не воспроизводится";
}

// Fetch account-wide playback state (whichever device is actually playing),
// not just our own Web Playback SDK device.
async function fetchSpotifyNowPlaying() {
    try {
        const response = await fetch('/spotify/api/now-playing/');
        return await response.json();
    } catch (error) {
        console.error('Error fetching Spotify now-playing:', error);
        return { success: false, playback: null };
    }
}

async function fetchSpotifyQueue() {
    try {
        const response = await fetch('/spotify/api/queue/');
        return await response.json();
    } catch (error) {
        console.error('Error fetching Spotify queue:', error);
        return { success: false, queue: [] };
    }
}

async function fetchSpotifyDevicesList() {
    try {
        const response = await fetch('/spotify/api/devices/');
        return await response.json();
    } catch (error) {
        console.error('Error fetching Spotify devices:', error);
        return { success: false, devices: [] };
    }
}

// Build Music widget data from real Spotify connection + playback state.
async function buildMusicWidgetData() {
    const status = await fetchSpotifyStatus();
    if (!status.connected) {
        return {
            type: "music_widget",
            connected: false,
            title: "Музыка",
            subtitle: "Spotify не подключён"
        };
    }
    const [nowPlaying, queueResult, devicesResult] = await Promise.all([
        fetchSpotifyNowPlaying(),
        fetchSpotifyQueue(),
        fetchSpotifyDevicesList()
    ]);
    const playback = nowPlaying.success ? nowPlaying.playback : null;
    return {
        type: "music_widget",
        connected: true,
        title: "Музыка",
        subtitle: musicSubtitleFor(playback),
        playback,
        queue: queueResult.success ? queueResult.queue : [],
        devices: devicesResult.success ? devicesResult.devices : [],
        quick_actions: MUSIC_QUICK_ACTIONS
    };
}

// Periodically refresh from the real Spotify API so the widget reflects
// playback started on any device (phone, desktop app, another browser tab) —
// the 'spotify:state' SDK event only covers our own registered device.
let musicPollIntervalId = null;

function stopMusicPolling() {
    if (musicPollIntervalId) {
        clearInterval(musicPollIntervalId);
        musicPollIntervalId = null;
    }
}

// Manual controls (shuffle/repeat/seek/favorite/...) are relayed through the
// AI agent as natural-language instructions, so they take a few seconds to
// actually land on Spotify's side. Suppress polling briefly after a manual
// action so its optimistic UI update isn't immediately clobbered by a poll
// tick that still reads the pre-command state.
let musicPollSuppressedUntil = 0;
// Survives across the 5s poll's full innerHTML rebuild, which would
// otherwise silently close the device dropdown mid-interaction.
let musicDeviceMenuOpen = false;
function suppressMusicPolling(ms) {
    musicPollSuppressedUntil = Date.now() + ms;
}

function startMusicPolling() {
    stopMusicPolling();
    musicPollIntervalId = setInterval(async () => {
        const widgetView = document.getElementById('widget-view');
        if (!currentWidget || currentWidget.type !== 'music_widget' || widgetView.classList.contains('hidden')) {
            stopMusicPolling();
            return;
        }
        if (Date.now() < musicPollSuppressedUntil) return;
        const [nowPlaying, queueResult] = await Promise.all([
            fetchSpotifyNowPlaying(),
            fetchSpotifyQueue()
        ]);
        if (!nowPlaying.success || !currentWidget || currentWidget.type !== 'music_widget') return;
        currentWidget.playback = nowPlaying.playback;
        currentWidget.subtitle = musicSubtitleFor(nowPlaying.playback);
        if (queueResult.success) currentWidget.queue = queueResult.queue;
        renderMusicWidget(currentWidget);
        lucide.createIcons();
    }, 5000);
}

// Keep the music widget in sync with live playback state from our own SDK
// device instantly (polling above covers other devices, on a 5s delay).
let musicStateListenerAttached = false;
function ensureMusicStateListener() {
    if (musicStateListenerAttached) return;
    musicStateListenerAttached = true;
    window.addEventListener('spotify:state', (event) => {
        if (!currentWidget || currentWidget.type !== 'music_widget' || !currentWidget.connected) return;
        const state = event.detail;
        if (!state) return;

        const track = state.track_window && state.track_window.current_track;
        const prevPlayback = currentWidget.playback || {};
        currentWidget.playback = {
            is_playing: !state.paused,
            progress_seconds: Math.round(state.position / 1000),
            volume: prevPlayback.volume ?? 65,
            shuffle: typeof state.shuffle === 'boolean' ? state.shuffle : prevPlayback.shuffle,
            repeat: typeof state.repeat_mode === 'number'
                ? ['off', 'context', 'track'][state.repeat_mode]
                : prevPlayback.repeat,
            has_context: !!(state.context && state.context.uri),
            current_track: track ? {
                track_id: track.id,
                title: track.name,
                artist: (track.artists || []).map(a => a.name).join(', '),
                album: track.album ? track.album.name : null,
                duration_seconds: Math.round(state.duration / 1000),
                cover_url: track.album && track.album.images && track.album.images[0]
                    ? track.album.images[0].url : null,
                is_favorite: prevPlayback.current_track ? prevPlayback.current_track.is_favorite : false
            } : null
        };
        currentWidget.subtitle = musicSubtitleFor(currentWidget.playback);

        renderMusicWidget(currentWidget);
        lucide.createIcons();
    });
}

const STATIC_DOCUMENTS_WIDGET = {
    type: "documents_widget",
    title: "Документы",
    subtitle: "147 документов в архиве",
    total_documents: 147,
    last_sync: "сегодня, 14:32",
    current_query: null,
    categories: [
        { category: "insurance", label: "Страховки", count: 23, icon: "shield-check" },
        { category: "contract", label: "Договоры", count: 45, icon: "file-signature" },
        { category: "invoice", label: "Счета", count: 38, icon: "receipt" },
        { category: "tax", label: "Налоги", count: 12, icon: "landmark" },
        { category: "medical", label: "Медицина", count: 18, icon: "heart-pulse" },
        { category: "other", label: "Другое", count: 11, icon: "folder" }
    ],
    search_results: [],
    recent_documents: [
        {
            document_id: "doc_1",
            filename: "haftpflicht_2024.pdf",
            title: "Haftpflichtversicherung 2024",
            document_type: "insurance",
            match_snippet: "Privat-Haftpflichtversicherung, Versicherungsnummer: HP-2024-****",
            relevance_score: 1.0,
            page_number: 1,
            date: "15.01.2024",
            file_size: "1.2 MB",
            tags: ["страховка", "ответственность", "2024"]
        },
        {
            document_id: "doc_2",
            filename: "mietvertrag_wohnung.pdf",
            title: "Mietvertrag Hauptstraße 42",
            document_type: "contract",
            match_snippet: "Mietvertrag für die Wohnung in der Hauptstraße 42, 97980 Bad Mergentheim",
            relevance_score: 1.0,
            page_number: 1,
            date: "01.03.2023",
            file_size: "3.4 MB",
            tags: ["аренда", "квартира", "договор"]
        },
        {
            document_id: "doc_3",
            filename: "stromrechnung_nov_2024.pdf",
            title: "Stromabrechnung November 2024",
            document_type: "invoice",
            match_snippet: "EnBW Stromabrechnung für den Zeitraum 01.11.2024 - 30.11.2024",
            relevance_score: 1.0,
            page_number: 1,
            date: "01.12.2024",
            file_size: "0.8 MB",
            tags: ["электричество", "счет", "EnBW"]
        }
    ],
    quick_actions: [
        {
            type: "assistant_button",
            text: "Загрузить документ",
            style: "primary",
            icon: "upload",
            assistant_request: "Загрузить новый документ в архив"
        },
        {
            type: "assistant_button",
            text: "Все страховки",
            style: "secondary",
            icon: "shield-check",
            assistant_request: "Покажи все мои страховки"
        }
    ]
};

// Current active widget
let currentWidget = null;

// Show widget view
async function showWidgetView(widgetType) {
    const chatView = document.getElementById('chat-view');
    const dashboardView = document.getElementById('dashboard-view');
    const widgetView = document.getElementById('widget-view');
    const leftSidebar = document.getElementById('left-sidebar');

    const voiceView = document.getElementById('voice-view');

    chatView.classList.add('hidden');
    dashboardView.classList.add('hidden');
    widgetView.classList.remove('hidden');
    if (voiceView) voiceView.classList.add('hidden');
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    leftSidebar.classList.add('hidden');

    updateSidebarActiveState(widgetType);

    if (widgetType === 'light') {
        // Load real data from API
        currentWidget = await buildLightWidgetData();
        renderLightWidget(currentWidget);
    } else if (widgetType === 'climate') {
        currentWidget = await buildClimateWidgetData();
        renderClimateWidget(currentWidget);
    } else if (widgetType === 'music') {
        ensureMusicStateListener();
        if (typeof ensureSpotifyPlayerConnected === 'function') {
            ensureSpotifyPlayerConnected();
        }
        currentWidget = await buildMusicWidgetData();
        renderMusicWidget(currentWidget);
        startMusicPolling();
    } else if (widgetType === 'documents') {
        currentWidget = STATIC_DOCUMENTS_WIDGET;
        renderDocumentsWidget(STATIC_DOCUMENTS_WIDGET);
    }

    lucide.createIcons();
}

// Render Light Widget
// Preferred room ordering; rooms listed here come first in this exact order,
// any other rooms follow in first-seen order, and "Other" (no room) is last.
const ROOM_ORDER = ['Гостиная', 'Спальня', 'Кухня', 'Коридор'];

// Group a list of {room, ...} items by room, sorted by ROOM_ORDER.
// Items without a room fall into an "Other" bucket at the end.
function groupByRoom(items) {
    const groups = new Map();
    const noRoom = [];
    items.forEach(item => {
        if (!item.room) {
            noRoom.push(item);
            return;
        }
        if (!groups.has(item.room)) groups.set(item.room, []);
        groups.get(item.room).push(item);
    });
    const rank = room => {
        const i = ROOM_ORDER.indexOf(room);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    // Array.sort is stable, so unranked rooms keep their first-seen order.
    const result = Array.from(groups.entries())
        .map(([room, devices]) => ({ room, devices }))
        .sort((a, b) => rank(a.room) - rank(b.room));
    if (noRoom.length) result.push({ room: 'Other', devices: noRoom });
    return result;
}

// Convert a colour temperature in Kelvin to an #RRGGBB tint, so a warm 2700K
// bulb reads amber and a cool 6500K one reads near-white/blue. Based on Tanner
// Helland's black-body approximation, clamped to byte range.
function kelvinToHex(kelvin) {
    const t = kelvin / 100;
    let r, g, b;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    }
    if (t >= 66) {
        b = 255;
    } else if (t <= 19) {
        b = 0;
    } else {
        b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    }
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    const hex = v => clamp(v).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Resolve the real colour a lit bulb should show, from the model's colour
// fields. Returns an #RRGGBB string, or null to fall back to Tailwind classes
// (bulb off, or no colour data reported).
function lightTintHex(device) {
    if (!device.is_on) return null;
    if (device.color_mode === 'color' && device.rgb_color) {
        return device.rgb_color;
    }
    if (device.color_mode === 'temperature' && device.color_temp) {
        return kelvinToHex(device.color_temp);
    }
    return null;
}

function renderLightWidget(data) {
    const container = document.getElementById('widget-container');

    const renderDeviceCard = device => {
        const isOn = device.is_on;
        const colorClass = getTailwindColorClass(device.color);
        const bgClass = isOn ? getTailwindBgColorClass(device.color) : '';

        let statusText;
        if (!isOn) {
            statusText = 'Off';
        } else if (device.brightness) {
            statusText = `On, ${device.brightness}%`;
        } else {
            statusText = 'On';
        }

        // Prefer the bulb's actual colour (RGB or colour-temperature tint) via
        // inline styles; only fall back to the static Tailwind classes when
        // there's no colour data (off, or unreported).
        const tint = lightTintHex(device);
        const circleClass = tint
            ? 'w-12 h-12 rounded-full flex items-center justify-center'
            : `w-12 h-12 rounded-full flex items-center justify-center ${isOn ? bgClass + ' bg-opacity-20' : 'bg-gray-800'}`;
        const circleStyle = tint ? ` style="background-color: ${tint}33"` : '';
        const iconClass = tint ? 'w-6 h-6' : `w-6 h-6 ${colorClass}`;
        const iconStyle = tint ? ` style="color: ${tint}"` : '';

        return `
            <div class="glass-tile rounded-xl p-4 aspect-square flex flex-col items-center justify-center text-center gap-3" data-device-card="${device.device_id}">
                <div class="${circleClass}"${circleStyle}>
                    <i data-lucide="${device.icon}" class="${iconClass}"${iconStyle}></i>
                </div>
                <div>
                    <div class="text-white font-medium text-sm leading-tight">${device.name}</div>
                    <div class="text-gray-400 text-xs mt-0.5">${statusText}</div>
                </div>
            </div>
        `;
    };

    const roomGroups = groupByRoom(data.devices);
    const devicesHtml = roomGroups.map(({ room, devices }) => `
        <div class="mb-4">
            <h3 class="text-sm font-medium text-gray-400 mb-3">${room}</h3>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                ${devices.map(renderDeviceCard).join('')}
            </div>
        </div>
    `).join('');

    const renderSensorCard = sensor => {
        const colorClass = getTailwindColorClass(sensor.color);
        const bgClass = getTailwindBgColorClass(sensor.color);
        const lux = Math.round(sensor.illuminance);
        return `
            <div class="glass-tile rounded-xl p-4 flex items-center justify-between" data-sensor-card="${sensor.device_id}">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full ${bgClass} bg-opacity-20 flex items-center justify-center">
                        <i data-lucide="${sensor.icon}" class="w-5 h-5 ${colorClass}"></i>
                    </div>
                    <div>
                        <div class="text-white font-medium">${sensor.name}</div>
                        ${sensor.last_updated ? `<div class="text-gray-400 text-sm">${sensor.last_updated}</div>` : ''}
                    </div>
                </div>
                <div class="text-right">
                    <div class="text-xl font-bold ${colorClass}">${lux}</div>
                    <div class="text-gray-500 text-xs">lux</div>
                </div>
            </div>
        `;
    };

    const sensors = data.sensors || [];
    const sensorsHtml = sensors.length ? `
        <div class="mb-6">
            <h3 class="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <i data-lucide="sun" class="w-4 h-4"></i>
                Light sensors
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${groupByRoom(sensors).map(({ room, devices }) => `
                    <div>
                        <h4 class="text-xs font-medium text-gray-500 mb-2">${room}</h4>
                        <div class="space-y-3">
                            ${devices.map(renderSensorCard).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    const quickActionsHtml = data.quick_actions.map(action => {
        const styleClass = action.style === 'primary'
            ? 'bg-blue-600 hover:bg-blue-500'
            : 'bg-gray-700 hover:bg-gray-600';
        return `
            <button class="flex-1 px-4 py-3 ${styleClass} text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2">
                <i data-lucide="${action.icon}" class="w-5 h-5"></i>
                ${action.text}
            </button>
        `;
    }).join('');

    container.innerHTML = `
        <div class="glass-tile rounded-2xl p-6">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-2xl font-bold text-white">${data.title}</h2>
                    <p class="text-gray-400">${data.subtitle}</p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-3xl font-bold text-yellow-500">${data.on_count}</span>
                    <span class="text-gray-500 text-lg">/ ${data.total_count}</span>
                </div>
            </div>

            <div class="mb-6">
                ${devicesHtml || '<p class="text-gray-500 text-sm">No devices available</p>'}
            </div>

            ${sensorsHtml}

            <div class="flex gap-3">
                ${quickActionsHtml}
            </div>
        </div>
    `;
}

// Render Climate Widget
function renderClimateWidget(data) {
    const container = document.getElementById('widget-container');

    const modeLabels = { heat: 'Heating', off: 'Off', auto: 'Auto', eco: 'Eco' };

    const renderRadiatorCard = radiator => {
        const isOn = radiator.is_on;
        const colorClass = getTailwindColorClass(radiator.color);
        const bgClass = getTailwindBgColorClass(radiator.color);

        const currentTempHtml = radiator.current_temp !== null && radiator.current_temp !== undefined
            ? `<div class="text-gray-500 text-xs mt-0.5">now ${radiator.current_temp}°C</div>`
            : '';

        return `
            <div class="glass-tile rounded-xl p-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center ${isOn ? bgClass + ' bg-opacity-20' : 'bg-gray-800'}">
                            <i data-lucide="${radiator.icon}" class="w-5 h-5 ${colorClass}"></i>
                        </div>
                        <div>
                            <div class="text-white font-medium">${radiator.name}</div>
                            <div class="text-gray-400 text-sm">${modeLabels[radiator.mode]}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-2xl font-bold ${colorClass}">${radiator.target_temp}°C</div>
                        <div class="text-gray-500 text-xs">target</div>
                        ${currentTempHtml}
                    </div>
                </div>
            </div>
        `;
    };

    const radiatorsHtml = groupByRoom(data.radiators).map(({ room, devices }) => `
        <div class="mb-4 break-inside-avoid">
            <h4 class="text-xs font-medium text-gray-500 mb-2">${room}</h4>
            <div class="space-y-3">
                ${devices.map(renderRadiatorCard).join('')}
            </div>
        </div>
    `).join('');

    const renderSensorCard = sensor => {
        const colorClass = getTailwindColorClass(sensor.color);
        const hasBattery = sensor.battery_level !== null && sensor.battery_level !== undefined;
        const batteryIcon = sensor.battery_level > 50 ? 'battery-full' : sensor.battery_level > 20 ? 'battery-medium' : 'battery-low';
        const batteryColor = sensor.battery_level > 50 ? 'text-green-500' : sensor.battery_level > 20 ? 'text-yellow-500' : 'text-red-500';
        const batteryHtml = hasBattery ? `
                    <div class="flex items-center gap-1 ${batteryColor}">
                        <i data-lucide="${batteryIcon}" class="w-4 h-4"></i>
                        <span class="text-xs">${sensor.battery_level}%</span>
                    </div>` : '';

        return `
            <div class="glass-tile rounded-xl p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
                        <i data-lucide="${sensor.icon}" class="w-5 h-5 ${colorClass}"></i>
                    </div>
                    <div>
                        <div class="text-white font-medium">${sensor.name}</div>
                        ${sensor.last_updated ? `<div class="text-gray-400 text-sm">${sensor.last_updated}</div>` : ''}
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-center">
                        <div class="text-xl font-bold text-white">${sensor.temperature}°C</div>
                        <div class="text-gray-500 text-xs">temp.</div>
                    </div>
                    <div class="text-center">
                        <div class="text-xl font-bold text-blue-400">${sensor.humidity}%</div>
                        <div class="text-gray-500 text-xs">hum.</div>
                    </div>${batteryHtml}
                </div>
            </div>
        `;
    };

    const sensorsHtml = groupByRoom(data.sensors).map(({ room, devices }) => `
        <div class="mb-4 break-inside-avoid">
            <h4 class="text-xs font-medium text-gray-500 mb-2">${room}</h4>
            <div class="space-y-3">
                ${devices.map(renderSensorCard).join('')}
            </div>
        </div>
    `).join('');

    const quickActionsHtml = data.quick_actions.map(action => {
        const styleClass = action.style === 'primary'
            ? 'bg-green-600 hover:bg-green-500'
            : 'bg-gray-700 hover:bg-gray-600';
        return `
            <button class="flex-1 px-4 py-3 ${styleClass} text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2">
                <i data-lucide="${action.icon}" class="w-5 h-5"></i>
                ${action.text}
            </button>
        `;
    }).join('');

    container.innerHTML = `
        <div class="glass-tile rounded-2xl p-6">
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-2xl font-bold text-white">${data.title}</h2>
                    <p class="text-gray-400">${data.subtitle}</p>
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-center">
                        <div class="text-3xl font-bold text-green-500">${data.average_temp}°C</div>
                        <div class="text-gray-500 text-xs">average</div>
                    </div>
                    <div class="text-center">
                        <div class="text-3xl font-bold text-blue-400">${data.average_humidity}%</div>
                        <div class="text-gray-500 text-xs">hum.</div>
                    </div>
                </div>
            </div>

            <div class="mb-4">
                <h3 class="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                    <i data-lucide="heater" class="w-4 h-4"></i>
                    Radiators
                </h3>
                <div class="columns-1 sm:columns-2 gap-4">
                    ${radiatorsHtml || '<p class="text-gray-500 text-sm">No radiators available</p>'}
                </div>
            </div>

            <div class="mb-6">
                <h3 class="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                    <i data-lucide="thermometer" class="w-4 h-4"></i>
                    Sensors
                </h3>
                <div class="columns-1 sm:columns-2 gap-4">
                    ${sensorsHtml || '<p class="text-gray-500 text-sm">No sensors available</p>'}
                </div>
            </div>

            <div class="flex gap-3">
                ${quickActionsHtml}
            </div>
        </div>
    `;
}

// Helper: format seconds to mm:ss
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Build the segmented VU-meter markup for a given fill percentage
function buildVuMeterHtml(percent, segmentCount) {
    const litCount = Math.round((percent / 100) * segmentCount);
    let html = '';
    for (let i = 0; i < segmentCount; i++) {
        html += `<div class="vu-meter__segment${i < litCount ? ' is-lit' : ''}"></div>`;
    }
    return html;
}

// Render Music Widget — retro hi-fi / vinyl lounge theme
function renderMusicWidget(data) {
    const container = document.getElementById('widget-container');

    if (!data.connected) {
        container.innerHTML = `
            <div class="vinyl-card rounded-2xl p-6">
                <div class="flex items-center justify-between mb-5">
                    <div>
                        <span class="vinyl-card__eyebrow"><span class="vinyl-card__eyebrow-dot"></span>Hi-Fi</span>
                        <h2 class="vinyl-card__title text-2xl text-[--vinyl-cream] mt-1" style="color: var(--vinyl-cream)">${data.title}</h2>
                    </div>
                    <i data-lucide="disc-3" class="w-7 h-7" style="color: var(--vinyl-amber)"></i>
                </div>
                <div class="rounded-xl p-8 text-center" style="background: rgba(0,0,0,0.25); border: 1px dashed rgba(232,169,79,0.3)">
                    <i data-lucide="music" class="w-14 h-14 mx-auto mb-4" style="color: var(--vinyl-copper)"></i>
                    <div class="mb-4" style="color: var(--vinyl-cream); opacity: 0.7">${data.subtitle}</div>
                    <a href="/spotify/authorize/" class="vinyl-btn vinyl-btn--play inline-flex items-center gap-2 px-5 py-3 font-medium" style="border-radius: 999px;">
                        <i data-lucide="plug-zap" class="w-5 h-5"></i>
                        Подключить Spotify
                    </a>
                </div>
            </div>
        `;
        return;
    }

    const playback = data.playback || {};
    const currentTrack = playback.current_track;
    const progressPercent = currentTrack ? (playback.progress_seconds / currentTrack.duration_seconds) * 100 : 0;
    const volume = playback.volume ?? 65;
    const isPlaying = !!playback.is_playing;
    const isFavorite = !!(currentTrack && currentTrack.is_favorite);
    const repeatMode = playback.repeat || 'off';
    const hasContext = playback.has_context !== false;
    const devices = data.devices || [];
    const currentDevice = devices.find(d => d.is_selected) || devices.find(d => d.is_active);

    const deviceMenuHtml = devices.length ? `
        <div id="music-device-menu" class="hidden absolute right-0 top-full mt-2 z-20 rounded-xl overflow-hidden"
             style="background: #221a10; border: 1px solid rgba(232,169,79,0.3); min-width: 220px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
            ${devices.map(d => `
                <button class="music-device-option w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors"
                        data-device-id="${d.id}"
                        style="background: ${d.is_selected ? 'rgba(232,169,79,0.15)' : 'transparent'};">
                    <i data-lucide="${d.type === 'Smartphone' ? 'smartphone' : 'monitor-speaker'}" class="w-4 h-4 flex-shrink-0"
                       style="color: ${d.is_selected ? 'var(--vinyl-amber)' : 'var(--vinyl-cream)'}; opacity: ${d.is_selected ? '1' : '0.6'};"></i>
                    <span class="truncate text-sm" style="color: var(--vinyl-cream); opacity: ${d.is_selected ? '1' : '0.75'};">${d.name}</span>
                    ${d.is_active ? '<span class="ml-auto text-xs" style="color: var(--vinyl-teal)">●</span>' : ''}
                </button>
            `).join('')}
        </div>
    ` : '';

    const nowPlayingHtml = currentTrack ? `
        <div class="rounded-xl p-4 mb-4" style="background: rgba(0,0,0,0.22)">
            <div class="flex items-center gap-4">
                <div class="vinyl-disc-wrap">
                    <div class="vinyl-disc${isPlaying ? ' is-spinning' : ''}" style="animation-delay: -${Date.now() % VINYL_SPIN_DURATION_MS}ms">
                        <div class="vinyl-disc__spindle"></div>
                        <div class="vinyl-disc__label">
                            ${currentTrack.cover_url
                                ? `<img src="${currentTrack.cover_url}">`
                                : `<i data-lucide="music" class="w-6 h-6" style="color: var(--vinyl-ink)"></i>`
                            }
                        </div>
                    </div>
                    <div class="vinyl-tonearm${isPlaying ? ' is-down' : ''}"></div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="vinyl-card__title text-lg truncate" style="color: var(--vinyl-cream)">${currentTrack.title}</div>
                    <div class="truncate text-sm mt-0.5" style="color: var(--vinyl-amber)">${currentTrack.artist}</div>
                    <div class="truncate text-xs mt-0.5" style="color: var(--vinyl-cream); opacity: 0.45">${currentTrack.album || ''}</div>
                </div>
                <button id="music-favorite-btn" title="${isFavorite ? 'Убрать из избранного' : 'В избранное'}"
                        style="color: ${isFavorite ? '#f472b6' : 'var(--vinyl-cream)'}; opacity: ${isFavorite ? '1' : '0.4'};">
                    <i data-lucide="heart" class="w-5 h-5${isFavorite ? ' fill-current' : ''}"></i>
                </button>
            </div>

            <!-- VU-meter progress (click to seek) -->
            <div class="mt-4">
                <div id="music-vu-meter" class="vu-meter" style="cursor: pointer;">${buildVuMeterHtml(progressPercent, 36)}</div>
                <div class="flex justify-between text-xs mt-1.5 font-mono" style="color: var(--vinyl-cream); opacity: 0.5">
                    <span>${formatDuration(playback.progress_seconds)}</span>
                    <span>${formatDuration(currentTrack.duration_seconds)}</span>
                </div>
            </div>

            <!-- Transport controls -->
            <div class="flex items-center justify-center gap-4 mt-5">
                <button id="music-shuffle-btn" class="vinyl-btn w-8 h-8" title="Перемешать"
                        style="color: ${playback.shuffle ? 'var(--vinyl-amber)' : 'var(--vinyl-cream)'}; opacity: ${playback.shuffle ? '1' : '0.5'};">
                    <i data-lucide="shuffle" class="w-4 h-4"></i>
                </button>
                <button id="music-prev-btn" class="vinyl-btn w-9 h-9" title="${hasContext ? 'Предыдущий' : 'Недоступно без плейлиста/альбома'}"
                        ${hasContext ? '' : 'disabled'} style="opacity: ${hasContext ? '1' : '0.35'}; cursor: ${hasContext ? 'pointer' : 'not-allowed'};">
                    <i data-lucide="skip-back" class="w-4 h-4"></i>
                </button>
                <button id="music-play-btn" class="vinyl-btn vinyl-btn--play w-14 h-14" title="${isPlaying ? 'Пауза' : 'Воспроизвести'}">
                    <i data-lucide="${isPlaying ? 'pause' : 'play'}" class="w-6 h-6 ${isPlaying ? '' : 'ml-0.5'}"></i>
                </button>
                <button id="music-next-btn" class="vinyl-btn w-9 h-9" title="${hasContext ? 'Следующий' : 'Недоступно без плейлиста/альбома'}"
                        ${hasContext ? '' : 'disabled'} style="opacity: ${hasContext ? '1' : '0.35'}; cursor: ${hasContext ? 'pointer' : 'not-allowed'};">
                    <i data-lucide="skip-forward" class="w-4 h-4"></i>
                </button>
                <button id="music-repeat-btn" class="vinyl-btn w-8 h-8" title="Повтор: ${repeatMode}"
                        style="color: ${repeatMode !== 'off' ? 'var(--vinyl-amber)' : 'var(--vinyl-cream)'}; opacity: ${repeatMode !== 'off' ? '1' : '0.5'};">
                    <i data-lucide="${repeatMode === 'track' ? 'repeat-1' : 'repeat'}" class="w-4 h-4"></i>
                </button>
            </div>

            <!-- Volume fader -->
            <div class="flex items-center gap-3 mt-5 px-2">
                <i data-lucide="${volume === 0 ? 'volume-x' : volume < 50 ? 'volume-1' : 'volume-2'}" class="w-4 h-4" style="color: var(--vinyl-copper)"></i>
                <input id="music-volume-slider" type="range" min="0" max="100" value="${volume}"
                       class="vinyl-fader flex-1" style="--vinyl-fill: ${volume}%">
                <span id="music-volume-label" class="text-xs font-mono w-8" style="color: var(--vinyl-cream); opacity: 0.6">${volume}%</span>
            </div>
        </div>
    ` : `
        <div class="rounded-xl p-8 mb-4 text-center" style="background: rgba(0,0,0,0.22)">
            <div class="vinyl-disc mx-auto mb-4" style="width: 4.5rem; height: 4.5rem;">
                <div class="vinyl-disc__label"><i data-lucide="music" class="w-5 h-5" style="color: var(--vinyl-ink)"></i></div>
                <div class="vinyl-disc__spindle"></div>
            </div>
            <div style="color: var(--vinyl-cream); opacity: 0.6">Ничего не воспроизводится</div>
        </div>
    `;

    const queue = data.queue || [];
    const queueHtml = queue.length > 0 ? `
        <div class="mt-4 pt-4" style="border-top: 1px solid rgba(232,169,79,0.15);">
            <div class="text-xs uppercase tracking-wide mb-2" style="color: var(--vinyl-cream); opacity: 0.4;">Далее в очереди</div>
            ${queue.map((item, index) => `
                <button class="music-queue-item flex items-center gap-2 w-full text-left py-1.5 px-2 -mx-2 rounded-lg transition-colors"
                        data-index="${index}"
                        onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                    <span class="text-sm truncate flex-1" style="color: var(--vinyl-cream); opacity: 0.75;">${item.title} — ${item.artist}</span>
                    <span class="text-xs font-mono flex-shrink-0" style="color: var(--vinyl-cream); opacity: 0.35;">${formatDuration(item.duration_seconds)}</span>
                </button>
            `).join('')}
        </div>
    ` : '';

    const quickActionsHtml = (data.quick_actions || []).map((action, index) => `
        <button class="flex-1 px-4 py-3 font-medium flex items-center justify-center gap-2 rounded-lg transition-transform hover:scale-[1.02]"
                style="${index === 0
                    ? 'background: linear-gradient(135deg, var(--vinyl-amber), var(--vinyl-copper)); color: var(--vinyl-ink);'
                    : 'background: rgba(255,255,255,0.06); color: var(--vinyl-cream); border: 1px solid rgba(232,169,79,0.2);'}">
            <i data-lucide="${action.icon}" class="w-5 h-5"></i>
            ${action.text}
        </button>
    `).join('');

    container.innerHTML = `
        <div class="vinyl-card rounded-2xl p-6">
            <div class="flex items-center justify-between mb-4">
                <div>
                    <span class="vinyl-card__eyebrow"><span class="vinyl-card__eyebrow-dot${isPlaying ? ' is-live' : ''}"></span>${isPlaying ? 'Сейчас играет' : 'Hi-Fi'}</span>
                    <h2 class="vinyl-card__title text-2xl mt-1" style="color: var(--vinyl-cream)">${data.title}</h2>
                </div>
                <div class="relative">
                    <button id="music-device-btn" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors"
                            title="${currentDevice ? currentDevice.name : 'Устройство не выбрано'}"
                            style="background: rgba(255,255,255,0.06); border: 1px solid rgba(232,169,79,0.25);">
                        <i data-lucide="${currentDevice && currentDevice.type === 'Smartphone' ? 'smartphone' : 'monitor-speaker'}"
                           class="w-4 h-4" style="color: var(--vinyl-amber)"></i>
                        <span class="text-xs truncate max-w-[90px]" style="color: var(--vinyl-cream)">${currentDevice ? currentDevice.name : 'Устройство'}</span>
                        <i data-lucide="chevron-down" class="w-3 h-3" style="color: var(--vinyl-cream); opacity: 0.6"></i>
                    </button>
                    ${deviceMenuHtml}
                </div>
            </div>

            ${nowPlayingHtml}
            ${queueHtml}

            <div class="flex gap-3 mt-4">
                ${quickActionsHtml}
            </div>
        </div>
    `;

    queue.forEach((item, index) => {
        const el = container.querySelector(`.music-queue-item[data-index="${index}"]`);
        if (el) el.addEventListener('click', () => {
            suppressMusicPolling(8000);
            spotifyControl('play_track', `${item.title} — ${item.artist}`);
        });
    });

    const deviceBtn = document.getElementById('music-device-btn');
    const deviceMenu = document.getElementById('music-device-menu');
    if (deviceBtn && deviceMenu) {
        if (musicDeviceMenuOpen) deviceMenu.classList.remove('hidden');
        deviceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            musicDeviceMenuOpen = !musicDeviceMenuOpen;
            deviceMenu.classList.toggle('hidden', !musicDeviceMenuOpen);
        });
        container.querySelectorAll('.music-device-option').forEach(el => {
            el.addEventListener('click', async () => {
                musicDeviceMenuOpen = false;
                deviceMenu.classList.add('hidden');
                await selectSpotifyDevice(el.dataset.deviceId);
                suppressMusicPolling(2000);
                currentWidget = await buildMusicWidgetData();
                renderMusicWidget(currentWidget);
                lucide.createIcons();
            });
        });
        document.addEventListener('click', () => {
            musicDeviceMenuOpen = false;
            deviceMenu.classList.add('hidden');
        }, { once: true });
    }

    if (!currentTrack) return;

    if (hasContext) {
        document.getElementById('music-prev-btn').addEventListener('click', () => {
            suppressMusicPolling(8000);
            spotifyControl('previous');
        });
        document.getElementById('music-next-btn').addEventListener('click', () => {
            suppressMusicPolling(8000);
            spotifyControl('next');
        });
    }
    document.getElementById('music-play-btn').addEventListener('click', () => {
        suppressMusicPolling(8000);
        spotifyControl(isPlaying ? 'pause' : 'play');
    });
    document.getElementById('music-favorite-btn').addEventListener('click', () => {
        suppressMusicPolling(8000);
        spotifyControl(isFavorite ? 'unfavorite' : 'favorite');
        currentTrack.is_favorite = !isFavorite;
        renderMusicWidget(data);
        lucide.createIcons();
    });
    document.getElementById('music-shuffle-btn').addEventListener('click', () => {
        suppressMusicPolling(8000);
        const next = !playback.shuffle;
        spotifyControl('shuffle', next);
        playback.shuffle = next;
        renderMusicWidget(data);
        lucide.createIcons();
    });
    document.getElementById('music-repeat-btn').addEventListener('click', () => {
        suppressMusicPolling(8000);
        const next = MUSIC_REPEAT_CYCLE[repeatMode];
        spotifyControl('repeat', next);
        playback.repeat = next;
        renderMusicWidget(data);
        lucide.createIcons();
    });
    document.getElementById('music-vu-meter').addEventListener('click', (e) => {
        suppressMusicPolling(8000);
        const rect = e.currentTarget.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const newProgress = Math.round(fraction * currentTrack.duration_seconds);
        spotifyControl('seek', newProgress);
        playback.progress_seconds = newProgress;
        renderMusicWidget(data);
        lucide.createIcons();
    });
    document.getElementById('music-volume-slider').addEventListener('input', (e) => {
        e.target.style.setProperty('--vinyl-fill', `${e.target.value}%`);
        document.getElementById('music-volume-label').textContent = `${e.target.value}%`;
    });
    document.getElementById('music-volume-slider').addEventListener('change', (e) => {
        suppressMusicPolling(8000);
        spotifyControl('volume', Number(e.target.value));
    });
}

// Document type icons and colors
const DOCUMENT_TYPE_CONFIG = {
    insurance: { icon: "shield-check", color: "text-green-500", bg: "bg-green-500/20", label: "Страховка" },
    contract: { icon: "file-signature", color: "text-blue-500", bg: "bg-blue-500/20", label: "Договор" },
    invoice: { icon: "receipt", color: "text-orange-500", bg: "bg-orange-500/20", label: "Счёт" },
    receipt: { icon: "file-check", color: "text-yellow-500", bg: "bg-yellow-500/20", label: "Квитанция" },
    tax: { icon: "landmark", color: "text-red-500", bg: "bg-red-500/20", label: "Налоги" },
    medical: { icon: "heart-pulse", color: "text-pink-500", bg: "bg-pink-500/20", label: "Медицина" },
    legal: { icon: "scale", color: "text-purple-500", bg: "bg-purple-500/20", label: "Юр. документ" },
    other: { icon: "folder", color: "text-gray-400", bg: "bg-gray-500/20", label: "Другое" }
};

// Render Documents Widget
function renderDocumentsWidget(data) {
    const container = document.getElementById('widget-container');
    const hasSearchResults = data.search_results && data.search_results.length > 0;
    const documentsToShow = hasSearchResults ? data.search_results : data.recent_documents;

    // Categories pills
    const categoriesHtml = data.categories.map(cat => `
        <button class="category-filter flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-sm"
                data-category="${cat.category}">
            <i data-lucide="${cat.icon}" class="w-3.5 h-3.5 text-gray-400"></i>
            <span class="text-gray-300">${cat.label}</span>
            <span class="text-gray-500">${cat.count}</span>
        </button>
    `).join('');

    // Document results
    const documentsHtml = documentsToShow.map(doc => {
        const typeConfig = DOCUMENT_TYPE_CONFIG[doc.document_type] || DOCUMENT_TYPE_CONFIG.other;
        const relevancePercent = Math.round(doc.relevance_score * 100);
        
        return `
            <div class="glass-tile rounded-xl p-4 hover:bg-white/5 cursor-pointer transition-colors group"
                 data-document-id="${doc.document_id}">
                <div class="flex items-start gap-4">
                    <!-- Document icon -->
                    <div class="w-12 h-12 rounded-lg ${typeConfig.bg} flex items-center justify-center shrink-0">
                        <i data-lucide="${typeConfig.icon}" class="w-6 h-6 ${typeConfig.color}"></i>
                    </div>
                    
                    <!-- Content -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-white font-medium truncate">${doc.title}</span>
                            ${hasSearchResults ? `
                                <span class="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">${relevancePercent}%</span>
                            ` : ''}
                        </div>
                        <div class="text-gray-500 text-sm truncate mb-2">${doc.filename}</div>
                        <div class="text-gray-400 text-sm line-clamp-2">${doc.match_snippet}</div>
                        
                        <!-- Meta info -->
                        <div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
                            ${doc.date ? `<span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3 h-3"></i>${doc.date}</span>` : ''}
                            ${doc.page_number ? `<span class="flex items-center gap-1"><i data-lucide="file-text" class="w-3 h-3"></i>стр. ${doc.page_number}</span>` : ''}
                            ${doc.file_size ? `<span>${doc.file_size}</span>` : ''}
                        </div>
                        
                        <!-- Tags -->
                        ${doc.tags && doc.tags.length > 0 ? `
                            <div class="flex flex-wrap gap-1 mt-2">
                                ${doc.tags.map(tag => `
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400">${tag}</span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    
                    <!-- Actions -->
                    <div class="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Открыть">
                            <i data-lucide="external-link" class="w-4 h-4"></i>
                        </button>
                        <button class="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Скачать">
                            <i data-lucide="download" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Quick actions
    const quickActionsHtml = data.quick_actions.map(action => {
        const styleClass = action.style === 'primary'
            ? 'bg-blue-600 hover:bg-blue-500'
            : 'bg-gray-700 hover:bg-gray-600';
        return `
            <button class="flex-1 px-4 py-3 ${styleClass} text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2">
                <i data-lucide="${action.icon}" class="w-5 h-5"></i>
                ${action.text}
            </button>
        `;
    }).join('');

    container.innerHTML = `
        <div class="glass-tile rounded-2xl p-6">
            <!-- Header -->
            <div class="flex items-center justify-between mb-4">
                <div>
                    <h2 class="text-2xl font-bold text-white">${data.title}</h2>
                    <p class="text-gray-400 text-sm">${data.subtitle}</p>
                </div>
                <div class="flex items-center gap-2 text-gray-500 text-xs">
                    <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                    <span>${data.last_sync || 'не синхр.'}</span>
                </div>
            </div>
            
            <!-- Search input -->
            <div class="relative mb-4">
                <div class="absolute inset-0 bg-white/5 rounded-xl"></div>
                <div class="relative flex items-center">
                    <i data-lucide="search" class="w-5 h-5 text-gray-500 ml-4"></i>
                    <input type="text" 
                           id="document-search-input"
                           placeholder="Поиск по документам..." 
                           value="${data.current_query || ''}"
                           class="flex-1 bg-transparent text-white placeholder-gray-500 border-none outline-none p-4">
                    ${data.current_query ? `
                        <button id="clear-search-btn" class="p-2 mr-2 text-gray-500 hover:text-white transition-colors">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
            
            <!-- Categories -->
            <div class="flex flex-wrap gap-2 mb-4">
                ${categoriesHtml}
            </div>
            
            <!-- Results header -->
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-medium text-gray-400 flex items-center gap-2">
                    <i data-lucide="${hasSearchResults ? 'search' : 'clock'}" class="w-4 h-4"></i>
                    ${hasSearchResults ? `Результаты поиска (${data.search_results.length})` : 'Недавние документы'}
                </h3>
            </div>
            
            <!-- Documents list -->
            <div class="space-y-3 mb-4 max-h-80 overflow-y-auto">
                ${documentsHtml.length > 0 ? documentsHtml : `
                    <div class="text-center py-8 text-gray-500">
                        <i data-lucide="file-search" class="w-12 h-12 mx-auto mb-3 opacity-50"></i>
                        <p>Документы не найдены</p>
                    </div>
                `}
            </div>
            
            <!-- Quick actions -->
            <div class="flex gap-3">
                ${quickActionsHtml}
            </div>
        </div>
    `;
    
    // Search input handler
    const searchInput = container.querySelector('#document-search-input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    // Simulate search (in real app, this would call API)
                    data.current_query = query;
                    data.search_results = data.recent_documents.filter(doc => 
                        doc.title.toLowerCase().includes(query.toLowerCase()) ||
                        doc.match_snippet.toLowerCase().includes(query.toLowerCase()) ||
                        (doc.tags && doc.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase())))
                    );
                    renderDocumentsWidget(data);
                    lucide.createIcons();
                }
            }
        });
    }
    
    // Clear search handler
    const clearBtn = container.querySelector('#clear-search-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            data.current_query = null;
            data.search_results = [];
            renderDocumentsWidget(data);
            lucide.createIcons();
        });
    }
    
    // Category filter handlers
    container.querySelectorAll('.category-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            data.current_query = DOCUMENT_TYPE_CONFIG[category]?.label || category;
            data.search_results = data.recent_documents.filter(doc => doc.document_type === category);
            renderDocumentsWidget(data);
            lucide.createIcons();
        });
    });
}

// Export functions to window
window.showWidgetView = showWidgetView;
window.renderLightWidget = renderLightWidget;
window.renderClimateWidget = renderClimateWidget;
window.renderMusicWidget = renderMusicWidget;
window.renderDocumentsWidget = renderDocumentsWidget;
window.buildLightWidgetData = buildLightWidgetData;
window.fetchLightWidgetData = fetchLightWidgetData;
window.buildClimateWidgetData = buildClimateWidgetData;

// Initialize widget input form handler
document.addEventListener('DOMContentLoaded', () => {
    const widgetForm = document.getElementById('widget-input-form');
    const widgetInput = document.getElementById('widget-input-field');
    
    if (widgetForm && widgetInput) {
        widgetForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = widgetInput.value.trim();
            if (!message) return;
            
            // Send message to chat assistant if available
            if (window.chatAssistantAPI && typeof window.chatAssistantAPI.sendMessage === 'function') {
                // Switch to chat view first
                if (typeof showChatView === 'function') {
                    showChatView();
                }
                // Small delay to ensure view switch completes
                setTimeout(() => {
                    window.chatAssistantAPI.sendMessage(message);
                }, 100);
            }
            
            widgetInput.value = '';
        });
    }
});
