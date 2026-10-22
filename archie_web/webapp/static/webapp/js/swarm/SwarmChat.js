// Swarm chat (ARCHIE-199): shared chat of Archie agents.
// Long-lived WS to the agent's /ws_swarm: history on connect, then live events.
// Protocol: archie_shared.swarm.models (SwarmServerEvent / SwarmClientCommand).
// ARCHIE-238: Play/Pause/Stop, settings of the spontaneous checks, long-term memory.

const SWARM_RECONNECT_MS = 3000;
const SWARM_MAX_MESSAGES = 200;
const SWARM_GROUP_COLOR = '#adb5bd';
const SWARM_STOP_CONFIRM_MS = 3000;
const SWARM_TASKS = { home: 'Дом', mail: 'Почта', calendar: 'Календарь', football: 'Футбол' };
const SWARM_IMPORTANCE = { low: 'к сведению', normal: 'на табло', high: 'важно · голос' };
const SWARM_OUTCOMES = { silent: 'ничего нового', reported: 'есть новости', failed: 'ошибка' };

const swarmState = {
    ws: null,
    active: false,
    reconnectTimer: null,
    agents: {},
    messages: [],
    typing: new Set(),
    control: null,
    stopArmedUntil: 0,
};

function swarmEscape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Group ID -> member agents, derived from SwarmAgentInfo.groups.
function swarmGroups() {
    const groups = {};
    Object.values(swarmState.agents).forEach(agent => {
        agent.groups.forEach(group => { (groups[group] = groups[group] || []).push(agent); });
    });
    return groups;
}

function swarmFormatText(text) {
    const groups = swarmGroups();
    return swarmEscape(text).replace(/@([a-z][a-z0-9_]*)/gi, (match, id) => {
        const key = id.toLowerCase();
        const color = swarmState.agents[key] ? swarmState.agents[key].color
            : groups[key] ? SWARM_GROUP_COLOR : null;
        if (!color) return match;
        return `<span class="swarm-mention" style="--agent-color:${color}">${match}</span>`;
    });
}

function swarmFormatTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function swarmSend(command) {
    if (swarmState.ws && swarmState.ws.readyState === WebSocket.OPEN) {
        swarmState.ws.send(JSON.stringify(command));
    }
}

// --- Rendering ---

function renderSwarmRoster() {
    const roster = document.getElementById('swarm-roster');
    const renderChip = agent => `
        <button class="swarm-agent ${agent.enabled ? '' : 'swarm-agent--off'}"
                style="--agent-color:${agent.color}" data-agent-id="${agent.agent_id}"
                title="${swarmEscape(agent.description)} — ${agent.enabled ? 'нажми, чтобы усыпить' : 'нажми, чтобы разбудить'}">
            <i data-lucide="${agent.icon}" class="w-4 h-4"></i>
            <span>@${agent.agent_id}</span>
            <span class="swarm-agent__role">${agent.role}</span>
        </button>`;
    const solo = Object.values(swarmState.agents).filter(agent => !agent.groups.length);
    const groups = Object.entries(swarmGroups()).map(([group, members]) => `
        <div class="swarm-group" title="@${group} — участники отвечают по очереди">
            <span class="swarm-group__name">@${group}</span>${members.map(renderChip).join('')}
        </div>`);
    roster.innerHTML = solo.map(renderChip).join('') + groups.join('');
    lucide.createIcons({ nodes: [roster] });
}

function renderSwarmActions(actions) {
    if (!actions.length) return '';
    return `<div class="swarm-msg__actions">${actions.map(action => `
        <span class="swarm-chip swarm-chip--${action.status}" title="${swarmEscape(action.arguments_json)}">
            ${action.status === 'success' ? '✓' : action.status === 'blocked' ? '⛔' : '✗'} ${swarmEscape(action.tool_name)}
        </span>`).join('')}</div>`;
}

function renderSwarmUsage(usage) {
    if (!usage) return '';
    const tokens = usage.input_tokens + usage.output_tokens;
    return `<span class="swarm-msg__usage" title="${swarmEscape(usage.model)}">${tokens} tok · $${usage.total_cost.toFixed(4)}</span>`;
}

function renderSwarmMessage(message) {
    if (message.kind === 'system') {
        return `<div class="swarm-msg swarm-msg--system">${swarmEscape(message.text)}</div>`;
    }
    if (message.sender === 'user') {
        return `
            <div class="swarm-msg swarm-msg--user">
                <div class="swarm-msg__bubble">${swarmFormatText(message.text)}</div>
                <div class="swarm-msg__meta">${swarmFormatTime(message.created_at)}</div>
            </div>`;
    }
    const agent = swarmState.agents[message.sender] || {
        agent_id: message.sender, display_name: message.sender, icon: 'bot', color: '#888', role: '',
    };
    if (message.kind === 'opinion') {
        return `
            <div class="swarm-msg swarm-msg--opinion" style="--agent-color:${agent.color}"
                 title="${swarmFormatTime(message.created_at)}">
                <i data-lucide="${agent.icon}" class="w-3 h-3"></i>
                <span class="swarm-msg__name">@${agent.agent_id}</span>
                <span>${swarmFormatText(message.text)}</span>
            </div>`;
    }
    const label = message.kind === 'decision'
        ? '<span class="swarm-msg__label">⚖ решение совета</span>'
        : message.kind === 'alert'
            ? `<span class="swarm-msg__label swarm-msg__label--${message.importance || 'low'}">🔔 ${SWARM_IMPORTANCE[message.importance] || 'оповещение'}</span>`
            : '';
    return `
        <div class="swarm-msg swarm-msg--agent swarm-msg--${message.kind} ${message.importance ? `swarm-msg--${message.importance}` : ''}" style="--agent-color:${agent.color}">
            <div class="swarm-msg__avatar"><i data-lucide="${agent.icon}" class="w-4 h-4"></i></div>
            <div class="swarm-msg__body">
                <div class="swarm-msg__head">
                    <span class="swarm-msg__name">@${agent.agent_id}</span>
                    ${label}
                    <span class="swarm-msg__meta">${swarmFormatTime(message.created_at)}</span>
                    ${renderSwarmUsage(message.usage)}
                </div>
                <div class="swarm-msg__bubble">${swarmFormatText(message.text)}</div>
                ${renderSwarmActions(message.actions)}
            </div>
        </div>`;
}

function renderSwarmFeed() {
    const feed = document.getElementById('swarm-feed');
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    feed.innerHTML = swarmState.messages.length
        ? swarmState.messages.map(renderSwarmMessage).join('')
        : '<div class="swarm-empty">Рой молчит. Он сам проверяет дом, почту, календарь и футбол и пишет, только когда есть новости. Можно написать рою — ответит совет. Или обратись напрямую: @light, @climate, @football.</div>';
    lucide.createIcons({ nodes: [feed] });
    if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function renderSwarmTyping() {
    const typing = document.getElementById('swarm-typing');
    const names = [...swarmState.typing].map(id => `@${id}`);
    typing.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'думают' : 'думает'}…` : '';
}

function renderSwarmStatus(text) {
    document.getElementById('swarm-status').textContent = text;
}

// --- Controls, settings and memory (ARCHIE-238) ---

function renderSwarmControls() {
    const control = swarmState.control;
    if (!control) return;
    const stopArmed = Date.now() < swarmState.stopArmedUntil;
    document.querySelectorAll('[data-swarm-mode]').forEach(button => {
        const mode = button.dataset.swarmMode;
        button.classList.toggle('swarm-mode--active', control.mode === mode);
        if (mode === 'stopped') {
            button.classList.toggle('swarm-mode--armed', stopArmed);
            button.querySelector('span').textContent = stopArmed ? 'Очистить чат?' : 'Stop';
        }
    });
    const parts = [];
    if (control.mode === 'running') {
        parts.push(control.next_run_at
            ? `следующая проверка в ${swarmFormatTime(control.next_run_at)}` : 'проверка идёт');
    } else {
        parts.push(control.mode === 'paused' ? 'пауза: проверок нет, чат работает' : 'рой выключен');
    }
    if (control.last_run) {
        const run = control.last_run;
        parts.push(`последняя: ${SWARM_TASKS[run.task]} — ${SWARM_OUTCOMES[run.outcome]} (${swarmFormatTime(run.finished_at)})`);
    }
    document.getElementById('swarm-schedule').textContent = parts.join(' · ');
    const input = document.getElementById('swarm-input');
    const stopped = control.mode === 'stopped';
    input.disabled = stopped;
    input.placeholder = stopped ? 'Рой выключен — нажми Play или Pause' : 'Напиши рою… @ — упомянуть агента';
    document.querySelector('.swarm__send').disabled = stopped;
}

function renderSwarmSettings() {
    const control = swarmState.control;
    const form = document.getElementById('swarm-settings-form');
    if (!control || form.contains(document.activeElement)) return;
    const settings = control.settings;
    ['interval_min_minutes', 'interval_max_minutes', 'active_from', 'active_until',
        'voice_from_weekday', 'voice_from_weekend', 'voice_until'].forEach(name => {
        form.elements[name].value = settings[name];
    });
    form.elements.football_teams.value = settings.football_teams.join(', ');
    form.querySelectorAll('[name="tasks"]').forEach(box => { box.checked = settings.tasks.includes(box.value); });
    document.getElementById('swarm-settings-error').textContent = '';
}

function renderSwarmMemory() {
    const list = document.getElementById('swarm-memory');
    const facts = swarmState.control ? swarmState.control.memory : [];
    list.innerHTML = facts.length
        ? facts.map(fact => `
            <li class="swarm-fact">
                <span>${swarmEscape(fact.text)}</span>
                <button type="button" class="swarm-fact__forget" data-fact-id="${fact.fact_id}" title="Забыть">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i></button>
            </li>`).join('')
        : '<li class="swarm-fact swarm-fact--empty">Пусто. Скажи рою «запомни…» — например, «не говори про влажность».</li>';
    lucide.createIcons({ nodes: [list] });
}

function readSwarmSettings(form) {
    const number = name => parseInt(form.elements[name].value, 10);
    return {
        interval_min_minutes: number('interval_min_minutes'),
        interval_max_minutes: number('interval_max_minutes'),
        active_from: form.elements.active_from.value,
        active_until: form.elements.active_until.value,
        voice_from_weekday: form.elements.voice_from_weekday.value,
        voice_from_weekend: form.elements.voice_from_weekend.value,
        voice_until: form.elements.voice_until.value,
        tasks: [...form.querySelectorAll('[name="tasks"]:checked')].map(box => box.value),
        football_teams: form.elements.football_teams.value.split(',').map(t => t.trim()).filter(Boolean),
    };
}

function saveSwarmSettings(e) {
    e.preventDefault();
    const form = e.target;
    const settings = readSwarmSettings(form);
    const error = document.getElementById('swarm-settings-error');
    if (!(settings.interval_min_minutes >= 1 && settings.interval_max_minutes <= 60
        && settings.interval_min_minutes <= settings.interval_max_minutes)) {
        error.textContent = 'Интервал: от 1 до 60 минут, минимум не больше максимума.';
        return;
    }
    error.textContent = '';
    swarmSend({ type: 'update_settings', settings });
    document.activeElement.blur();
    document.getElementById('swarm-settings').classList.add('hidden');
}

function setSwarmMode(mode) {
    if (mode === 'stopped' && swarmState.control.mode !== 'stopped' && Date.now() >= swarmState.stopArmedUntil) {
        // Stop clears the chat: the first click only asks to confirm.
        swarmState.stopArmedUntil = Date.now() + SWARM_STOP_CONFIRM_MS;
        renderSwarmControls();
        setTimeout(renderSwarmControls, SWARM_STOP_CONFIRM_MS);
        return;
    }
    swarmState.stopArmedUntil = 0;
    swarmSend({ type: 'set_mode', mode });
}

// --- Events ---

function setSwarmAgents(agents) {
    swarmState.agents = Object.fromEntries(agents.map(agent => [agent.agent_id, agent]));
    renderSwarmRoster();
}

function handleSwarmEvent(event) {
    if (event.type === 'history') {
        setSwarmAgents(event.agents);
        swarmState.messages = event.messages;
        swarmState.typing.clear();
        renderSwarmFeed();
        renderSwarmTyping();
        document.getElementById('swarm-feed').scrollTop = 1e9;
    } else if (event.type === 'message') {
        swarmState.messages.push(event.message);
        swarmState.messages = swarmState.messages.slice(-SWARM_MAX_MESSAGES);
        renderSwarmFeed();
    } else if (event.type === 'typing') {
        if (event.active) swarmState.typing.add(event.agent_id);
        else swarmState.typing.delete(event.agent_id);
        renderSwarmTyping();
    } else if (event.type === 'agents') {
        setSwarmAgents(event.agents);
    } else if (event.type === 'control') {
        swarmState.control = event;
        renderSwarmControls();
        renderSwarmSettings();
        renderSwarmMemory();
    } else if (event.type === 'error') {
        console.warn('Swarm error:', event.message);
        renderSwarmStatus(event.message);
    }
}

function connectSwarm() {
    clearTimeout(swarmState.reconnectTimer);
    // user_name makes the logged-in user the swarm owner (their UserState is used).
    const userName = encodeURIComponent(window.CURRENT_USER_NAME || '');
    const ws = new WebSocket(`${window.AI_AGENT_WS_URL}/ws_swarm?user_name=${userName}`);
    swarmState.ws = ws;
    renderSwarmStatus('подключение…');
    ws.onopen = () => renderSwarmStatus('');
    ws.onmessage = (e) => handleSwarmEvent(JSON.parse(e.data));
    ws.onclose = () => {
        if (swarmState.ws !== ws) return;
        swarmState.ws = null;
        if (swarmState.active) {
            renderSwarmStatus('нет связи, переподключаюсь…');
            swarmState.reconnectTimer = setTimeout(connectSwarm, SWARM_RECONNECT_MS);
        }
    };
}

function disconnectSwarm() {
    clearTimeout(swarmState.reconnectTimer);
    const ws = swarmState.ws;
    swarmState.ws = null;
    if (ws) ws.close();
}

// --- Input with @ autocomplete ---

function updateSwarmSuggestions() {
    const input = document.getElementById('swarm-input');
    const box = document.getElementById('swarm-suggestions');
    const match = input.value.slice(0, input.selectionStart).match(/@([a-z0-9_]*)$/i);
    const groupOptions = Object.entries(swarmGroups()).map(([group, members]) => ({
        agent_id: group,
        color: SWARM_GROUP_COLOR,
        description: `группа: ${members.map(m => '@' + m.agent_id).join(', ')}`,
    }));
    const options = match
        ? [...Object.values(swarmState.agents), ...groupOptions]
            .filter(a => a.agent_id.startsWith(match[1].toLowerCase()))
        : [];
    box.innerHTML = options.map(agent => `
        <button type="button" class="swarm-suggestion" data-agent-id="${agent.agent_id}" style="--agent-color:${agent.color}">
            @${agent.agent_id} <span>${swarmEscape(agent.description)}</span>
        </button>`).join('');
    box.classList.toggle('hidden', options.length === 0);
}

function insertSwarmMention(agentId) {
    const input = document.getElementById('swarm-input');
    const before = input.value.slice(0, input.selectionStart).replace(/@([a-z0-9_]*)$/i, `@${agentId} `);
    input.value = before + input.value.slice(input.selectionStart);
    input.focus();
    input.setSelectionRange(before.length, before.length);
    updateSwarmSuggestions();
}

function initSwarmChat() {
    const root = document.getElementById('swarm-root');
    if (!root) return;
    root.innerHTML = `
        <div class="swarm__header">
            <div class="swarm__top">
                <div class="swarm__title"><i data-lucide="messages-square" class="w-5 h-5"></i> Рой агентов
                    <span id="swarm-status" class="swarm__status"></span></div>
                <div class="swarm__controls">
                    <button type="button" class="swarm-mode" data-swarm-mode="running" title="Проверки и чат">
                        <i data-lucide="play" class="w-4 h-4"></i><span>Play</span></button>
                    <button type="button" class="swarm-mode" data-swarm-mode="paused" title="Без проверок, чат работает">
                        <i data-lucide="pause" class="w-4 h-4"></i><span>Pause</span></button>
                    <button type="button" class="swarm-mode swarm-mode--stop" data-swarm-mode="stopped" title="Выключить рой и очистить чат">
                        <i data-lucide="square" class="w-4 h-4"></i><span>Stop</span></button>
                    <button type="button" id="swarm-settings-toggle" class="swarm-mode" title="Настройки и память">
                        <i data-lucide="settings-2" class="w-4 h-4"></i></button>
                </div>
            </div>
            <div id="swarm-schedule" class="swarm__schedule"></div>
            <div id="swarm-settings" class="swarm-settings hidden">
                <form id="swarm-settings-form" class="swarm-settings__form">
                    <fieldset class="swarm-settings__group">
                        <legend>Проверки</legend>
                        <label>Пауза, мин <span class="swarm-settings__pair">
                            <input name="interval_min_minutes" type="number" min="1" max="60" required> –
                            <input name="interval_max_minutes" type="number" min="1" max="60" required></span></label>
                        <label>Работают <span class="swarm-settings__pair">
                            <input name="active_from" type="text" class="swarm-settings__time" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" inputmode="numeric" placeholder="ЧЧ:ММ" required> –
                            <input name="active_until" type="text" class="swarm-settings__time" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" inputmode="numeric" placeholder="ЧЧ:ММ" required></span></label>
                        <div class="swarm-settings__tasks">${Object.entries(SWARM_TASKS).map(([task, name]) => `
                            <label class="swarm-settings__check"><input type="checkbox" name="tasks" value="${task}"> ${name}</label>`).join('')}
                        </div>
                        <label>Команды <input name="football_teams" type="text" placeholder="Bayern München, Schalke 04"></label>
                    </fieldset>
                    <fieldset class="swarm-settings__group">
                        <legend>Голос</legend>
                        <label>Будни с <input name="voice_from_weekday" type="text" class="swarm-settings__time" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" inputmode="numeric" placeholder="ЧЧ:ММ" required></label>
                        <label>Выходные с <input name="voice_from_weekend" type="text" class="swarm-settings__time" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" inputmode="numeric" placeholder="ЧЧ:ММ" required></label>
                        <label>До <input name="voice_until" type="text" class="swarm-settings__time" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" inputmode="numeric" placeholder="ЧЧ:ММ" required></label>
                    </fieldset>
                    <fieldset class="swarm-settings__group swarm-settings__group--memory">
                        <legend>Память</legend>
                        <ul id="swarm-memory" class="swarm-memory"></ul>
                    </fieldset>
                    <div class="swarm-settings__footer">
                        <span id="swarm-settings-error" class="swarm-settings__error"></span>
                        <button type="submit" class="swarm-settings__save">Сохранить</button>
                    </div>
                </form>
            </div>
            <div id="swarm-roster" class="swarm__roster"></div>
        </div>
        <div id="swarm-feed" class="swarm__feed"></div>
        <div id="swarm-typing" class="swarm__typing"></div>
        <form id="swarm-form" class="swarm__form">
            <div id="swarm-suggestions" class="swarm__suggestions hidden"></div>
            <input id="swarm-input" class="swarm__input" maxlength="280" autocomplete="off"
                   placeholder="Напиши рою… @ — упомянуть агента">
            <button type="submit" class="swarm__send" title="Отправить"><i data-lucide="send" class="w-5 h-5"></i></button>
        </form>`;
    lucide.createIcons({ nodes: [root] });

    document.querySelectorAll('[data-swarm-mode]').forEach(button => {
        button.addEventListener('click', () => setSwarmMode(button.dataset.swarmMode));
    });
    document.getElementById('swarm-settings-toggle').addEventListener('click', () => {
        document.getElementById('swarm-settings').classList.toggle('hidden');
        renderSwarmSettings();
    });
    document.getElementById('swarm-settings-form').addEventListener('submit', saveSwarmSettings);
    document.getElementById('swarm-memory').addEventListener('click', (e) => {
        const button = e.target.closest('[data-fact-id]');
        if (button) swarmSend({ type: 'forget', fact_id: button.dataset.factId });
    });
    document.getElementById('swarm-roster').addEventListener('click', (e) => {
        const button = e.target.closest('[data-agent-id]');
        if (!button) return;
        const agent = swarmState.agents[button.dataset.agentId];
        swarmSend({ type: 'toggle_agent', agent_id: agent.agent_id, enabled: !agent.enabled });
    });
    document.getElementById('swarm-suggestions').addEventListener('click', (e) => {
        const button = e.target.closest('[data-agent-id]');
        if (button) insertSwarmMention(button.dataset.agentId);
    });
    const input = document.getElementById('swarm-input');
    input.addEventListener('input', updateSwarmSuggestions);
    document.getElementById('swarm-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        swarmSend({ type: 'user_message', text });
        input.value = '';
        updateSwarmSuggestions();
    });
}

// --- View switching (same pattern as showVoiceView in main.js) ---

function showSwarmView() {
    ['chat-view', 'dashboard-view', 'widget-view', 'voice-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    document.getElementById('swarm-view').classList.remove('hidden');
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    if (typeof stopDashboardPolling === 'function') stopDashboardPolling();
    document.getElementById('left-sidebar').classList.add('hidden');
    updateSidebarActiveState('swarm');
    swarmState.active = true;
    if (!swarmState.ws) connectSwarm();
}

function hideSwarmView() {
    const view = document.getElementById('swarm-view');
    if (view) view.classList.add('hidden');
    swarmState.active = false;
    disconnectSwarm();
}

window.showSwarmView = showSwarmView;
window.hideSwarmView = hideSwarmView;

document.addEventListener('DOMContentLoaded', initSwarmChat);
