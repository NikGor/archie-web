// Swarm chat (ARCHIE-199): shared chat of Archie agents.
// Long-lived WS to the agent's /ws_swarm: history on connect, then live events.
// Protocol: archie_shared.swarm.models (SwarmServerEvent / SwarmClientCommand).

const SWARM_RECONNECT_MS = 3000;
const SWARM_MAX_MESSAGES = 200;
const SWARM_GROUP_COLOR = '#adb5bd';

const swarmState = {
    ws: null,
    active: false,
    reconnectTimer: null,
    agents: {},
    messages: [],
    typing: new Set(),
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
    const decisionLabel = message.kind === 'decision'
        ? '<span class="swarm-msg__label">⚖ решение совета</span>' : '';
    return `
        <div class="swarm-msg swarm-msg--agent swarm-msg--${message.kind}" style="--agent-color:${agent.color}">
            <div class="swarm-msg__avatar"><i data-lucide="${agent.icon}" class="w-4 h-4"></i></div>
            <div class="swarm-msg__body">
                <div class="swarm-msg__head">
                    <span class="swarm-msg__name">@${agent.agent_id}</span>
                    ${decisionLabel}
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
        : '<div class="swarm-empty">Рой молчит. Просто напиши — ответит совет и поручит дело нужному агенту. Или обратись напрямую: @light, @climate, @football.</div>';
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
    } else if (event.type === 'error') {
        console.warn('Swarm error:', event.message);
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
            <div class="swarm__title"><i data-lucide="messages-square" class="w-5 h-5"></i> Рой агентов
                <span id="swarm-status" class="swarm__status"></span></div>
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
