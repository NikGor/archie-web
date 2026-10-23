// Swarm chat (ARCHIE-199): shared chat of Archie agents.
// Long-lived WS to the agent's /ws_swarm: history on connect, then live events.
// Protocol: archie_shared.swarm.models (SwarmServerEvent / SwarmClientCommand).
// ARCHIE-238: Play/Pause/Stop, settings of the spontaneous checks, long-term memory.
// ARCHIE-249: council discussion in rounds led by the consul, plan steps,
// a model per agent; all settings live in one modal window.

const SWARM_RECONNECT_MS = 3000;
const SWARM_MAX_MESSAGES = 200;
const SWARM_GROUP_COLOR = '#adb5bd';
const SWARM_STOP_CONFIRM_MS = 3000;
const SWARM_TASKS = { home: 'Дом', mail: 'Почта', calendar: 'Календарь', football: 'Футбол', weather: 'Погода' };
const SWARM_IMPORTANCE = { low: 'к сведению', normal: 'на табло', high: 'важно · голос' };
const SWARM_OUTCOMES = { silent: 'ничего нового', reported: 'есть новости', failed: 'ошибка' };
const SWARM_PROVIDERS = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', 'x-ai': 'xAI' };
const SWARM_SETTINGS_TABS = { agents: 'Агенты', checks: 'Проверки и голос', memory: 'Память' };
const SWARM_TIME_PATTERN = '([01][0-9]|2[0-3]):[0-5][0-9]';
const SWARM_STEP_PATTERN = /^(\d+)\/(\d+) @([a-z][a-z0-9_]*): ([\s\S]*)$/;

const swarmState = {
    ws: null,
    active: false,
    reconnectTimer: null,
    agents: {},
    models: [],
    messages: [],
    typing: new Set(),
    control: null,
    stopArmedUntil: 0,
    memoryTab: 'lasting',
    settingsTab: 'agents',
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

function swarmAgent(agentId) {
    return swarmState.agents[agentId] || {
        agent_id: agentId, display_name: agentId, icon: 'bot', color: '#888', role: '', groups: [],
    };
}

// "anthropic/claude-sonnet-5.5" -> "claude-sonnet-5.5"; OpenAI models have no prefix.
function swarmModelName(model) {
    return model ? model.split('/').pop() : '';
}

function swarmProvider(model) {
    return model && model.includes('/') ? model.split('/')[0] : 'openai';
}

// Chat paths ("/c/<id>/") and web links become links (alert chats, ARCHIE-247).
const SWARM_LINK_PATTERN = /(https?:\/\/[^\s<]+|\/c\/[0-9a-f-]{36}\/)/gi;

function swarmFormatText(text) {
    const groups = swarmGroups();
    return swarmEscape(text).replace(SWARM_LINK_PATTERN, url => {
        const label = url.startsWith('/c/') ? 'открыть чат' : url;
        return `<a class="swarm-link" href="${url}">${label}</a>`;
    }).replace(/@([a-z][a-z0-9_]*)/gi, (match, id) => {
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

function swarmIcons(node) {
    lucide.createIcons({ nodes: [node] });
}

// --- Header: who is awake ---

function renderSwarmCrew() {
    const crew = document.getElementById('swarm-crew');
    const agents = Object.values(swarmState.agents);
    const council = agents.filter(a => a.groups.includes('council'))
        .sort((a, b) => Number(b.chair) - Number(a.chair));
    const home = agents.filter(a => !a.groups.length);
    const avatar = agent => `
        <span class="swarm-avatar ${agent.enabled ? '' : 'swarm-avatar--off'} ${agent.chair ? 'swarm-avatar--chair' : ''}"
              style="--agent-color:${agent.color}"
              title="@${agent.agent_id}${agent.chair ? ' · консул' : ''} · ${swarmEscape(swarmModelName(agent.model))}${agent.enabled ? '' : ' · спит'}">
            <i data-lucide="${agent.icon}" class="w-3.5 h-3.5"></i></span>`;
    const awake = list => list.filter(a => a.enabled).length;
    crew.innerHTML = `
        <button type="button" class="swarm-crew__group" data-open-settings="agents" title="Совет: настроить участников">
            <span class="swarm-crew__label">Совет</span>
            <span class="swarm-crew__avatars">${council.map(avatar).join('')}</span>
        </button>
        <button type="button" class="swarm-crew__group" data-open-settings="agents" title="Агенты дома: настроить">
            <span class="swarm-crew__label">Дом ${awake(home)}/${home.length}</span>
            <span class="swarm-crew__avatars">${home.map(avatar).join('')}</span>
        </button>`;
    swarmIcons(crew);
}

// --- Feed ---

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
    return `<span class="swarm-msg__usage" title="${tokens} токенов · $${usage.total_cost.toFixed(4)}">${swarmEscape(swarmModelName(usage.model))} · $${usage.total_cost.toFixed(4)}</span>`;
}

// A plan step is done when its agent (or the system, on failure) answered it.
function swarmStepState(task, agentId) {
    const reply = swarmState.messages.find(m => m.reply_to === task.message_id
        && (m.sender === agentId || m.sender === 'system'));
    if (reply) return reply.sender === 'system' ? 'failed' : 'done';
    return swarmState.typing.has(agentId) ? 'running' : 'waiting';
}

function renderSwarmTask(message) {
    const match = message.text.match(SWARM_STEP_PATTERN);
    if (!match) return '';
    const [, number, total, agentId, task] = match;
    const agent = swarmAgent(agentId);
    const state = swarmStepState(message, agentId);
    const icon = { done: 'check', failed: 'x', running: 'loader-circle', waiting: 'clock' }[state];
    return `
        <div class="swarm-step swarm-step--${state}" style="--agent-color:${agent.color}">
            <span class="swarm-step__number">${number}/${total}</span>
            <i data-lucide="${agent.icon}" class="w-3.5 h-3.5 swarm-step__agent"></i>
            <span class="swarm-msg__name">@${agent.agent_id}</span>
            <span class="swarm-step__task">${swarmFormatText(task)}</span>
            <i data-lucide="${icon}" class="w-3.5 h-3.5 swarm-step__state"></i>
        </div>`;
}

function renderSwarmOpinion(message, previous) {
    const agent = swarmAgent(message.sender);
    // A divider opens every discussion round of one trigger.
    const newRound = message.round && !(previous && previous.kind === 'opinion'
        && previous.reply_to === message.reply_to && previous.round === message.round);
    const divider = newRound
        ? `<div class="swarm-round"><span>обсуждение · раунд ${message.round}</span></div>` : '';
    return `${divider}
        <div class="swarm-msg swarm-msg--opinion ${agent.chair ? 'swarm-msg--remark' : ''}" style="--agent-color:${agent.color}">
            <div class="swarm-msg__avatar swarm-msg__avatar--small"><i data-lucide="${agent.icon}" class="w-3.5 h-3.5"></i></div>
            <div class="swarm-msg__body">
                <div class="swarm-msg__head">
                    <span class="swarm-msg__name">@${agent.agent_id}</span>
                    ${agent.chair ? '<span class="swarm-msg__label">консул</span>' : ''}
                    <span class="swarm-msg__meta">${swarmFormatTime(message.created_at)}</span>
                    ${renderSwarmUsage(message.usage)}
                </div>
                <div class="swarm-msg__text">${swarmFormatText(message.text)}</div>
            </div>
        </div>`;
}

function renderSwarmMessage(message, previous) {
    if (message.kind === 'system') {
        return `<div class="swarm-msg swarm-msg--system">${swarmEscape(message.text)}</div>`;
    }
    if (message.kind === 'task') return renderSwarmTask(message);
    if (message.kind === 'opinion') return renderSwarmOpinion(message, previous);
    if (message.sender === 'user') {
        return `
            <div class="swarm-msg swarm-msg--user">
                <div class="swarm-msg__bubble">${swarmFormatText(message.text)}</div>
                <div class="swarm-msg__meta">${swarmFormatTime(message.created_at)}</div>
            </div>`;
    }
    const agent = swarmAgent(message.sender);
    if (message.kind === 'check') {
        // A spontaneous check that found nothing new (ARCHIE-242); click shows the whole note.
        return `
            <div class="swarm-msg swarm-msg--check" style="--agent-color:${agent.color}">
                <i data-lucide="${agent.icon}" class="w-3 h-3"></i>
                <span class="swarm-check__time">${swarmFormatTime(message.created_at)}</span>
                <span class="swarm-msg__name">@${agent.agent_id}</span>
                <span class="swarm-check__label">ничего нового</span>
                <span class="swarm-check__note">${swarmEscape(message.text)}</span>
            </div>`;
    }
    const label = message.kind === 'decision'
        ? '<span class="swarm-msg__label">⚖ решение</span>'
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
    const messages = swarmState.messages;
    feed.innerHTML = messages.length
        ? messages.map((message, i) => renderSwarmMessage(message, messages[i - 1])).join('')
        : `<div class="swarm-empty">
               <i data-lucide="messages-square" class="w-8 h-8"></i>
               <p>Рой молчит. Он сам проверяет дом, почту, календарь и футбол и пишет, только когда есть новости.</p>
               <p>Напиши рою — совет обсудит, а дворецкий раздаст задачи. Или обратись напрямую: @light, @climate, @football.</p>
           </div>`;
    swarmIcons(feed);
    if (atBottom) feed.scrollTop = feed.scrollHeight;
}

function renderSwarmTyping() {
    const typing = document.getElementById('swarm-typing');
    const agents = [...swarmState.typing].map(swarmAgent);
    typing.innerHTML = agents.length ? `
        <span class="swarm-typing__avatars">${agents.map(agent => `
            <span class="swarm-avatar swarm-avatar--busy" style="--agent-color:${agent.color}" title="@${agent.agent_id}">
                <i data-lucide="${agent.icon}" class="w-3 h-3"></i></span>`).join('')}</span>
        <span>${agents.map(a => '@' + a.agent_id).join(', ')} ${agents.length > 1 ? 'думают' : 'думает'}</span>
        <span class="swarm-typing__dots"><i></i><i></i><i></i></span>` : '';
    swarmIcons(typing);
}

function renderSwarmStatus(text) {
    const status = document.getElementById('swarm-status');
    status.textContent = text;
    status.classList.toggle('hidden', !text);
}

// --- Mode controls (ARCHIE-238) ---

function renderSwarmControls() {
    const control = swarmState.control;
    if (!control) return;
    const stopArmed = Date.now() < swarmState.stopArmedUntil;
    document.querySelectorAll('[data-swarm-mode]').forEach(button => {
        const mode = button.dataset.swarmMode;
        button.classList.toggle('swarm-mode--active', control.mode === mode);
        if (mode === 'stopped') {
            button.classList.toggle('swarm-mode--armed', stopArmed);
            button.querySelector('span').textContent = stopArmed ? 'Очистить?' : 'Stop';
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

// --- Settings modal: agents, checks and voice, memory ---

function openSwarmSettings(tab) {
    showSwarmSettingsTab(tab || swarmState.settingsTab);
    document.getElementById('swarm-modal').classList.remove('hidden');
    document.body.classList.add('swarm-modal-open');
    renderSwarmSettings(true);
}

function closeSwarmSettings() {
    document.getElementById('swarm-modal').classList.add('hidden');
    document.body.classList.remove('swarm-modal-open');
}

function showSwarmSettingsTab(tab) {
    swarmState.settingsTab = tab;
    document.querySelectorAll('[data-settings-tab]').forEach(button => {
        const active = button.dataset.settingsTab === tab;
        button.classList.toggle('swarm-modal__tab--active', active);
        button.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('[data-settings-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.settingsPanel !== tab);
    });
}

function renderSwarmModelOptions(agent) {
    const groups = {};
    swarmState.models.forEach(model => {
        const provider = SWARM_PROVIDERS[swarmProvider(model)] || 'Другие';
        (groups[provider] = groups[provider] || []).push(model);
    });
    // Big four first, the rest after them.
    const order = [...Object.values(SWARM_PROVIDERS), 'Другие'];
    return order.filter(name => groups[name]).map(name => `
        <optgroup label="${name}">${groups[name].map(model => `
            <option value="${swarmEscape(model)}" ${model === agent.model ? 'selected' : ''}>
                ${swarmEscape(swarmModelName(model))}${model === agent.default_model ? ' · по умолчанию' : ''}</option>`).join('')}
        </optgroup>`).join('');
}

function renderSwarmAgentRow(agent) {
    const changed = agent.model && agent.model !== agent.default_model;
    return `
        <li class="swarm-agent-row ${agent.enabled ? '' : 'swarm-agent-row--off'}" style="--agent-color:${agent.color}">
            <span class="swarm-agent-row__avatar"><i data-lucide="${agent.icon}" class="w-4 h-4"></i></span>
            <div class="swarm-agent-row__info">
                <div class="swarm-agent-row__title">
                    <span class="swarm-msg__name">@${agent.agent_id}</span>
                    ${agent.chair ? '<span class="swarm-badge swarm-badge--chair">консул</span>' : ''}
                    ${agent.groups.length ? '' : `<span class="swarm-badge">${agent.role === 'action' ? 'действует' : 'наблюдает'}</span>`}
                </div>
                <div class="swarm-agent-row__description">${swarmEscape(agent.description)}</div>
                <div class="swarm-agent-row__model">
                    <span class="swarm-provider swarm-provider--${swarmProvider(agent.model)}">${SWARM_PROVIDERS[swarmProvider(agent.model)] || 'Другая'}</span>
                    <select class="swarm-select" data-model-agent="${agent.agent_id}" aria-label="Модель @${agent.agent_id}">
                        ${renderSwarmModelOptions(agent)}
                    </select>
                    ${changed ? `<button type="button" class="swarm-reset" data-reset-model="${agent.agent_id}" title="Вернуть ${swarmEscape(swarmModelName(agent.default_model))}">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>` : ''}
                </div>
            </div>
            <label class="swarm-switch" title="${agent.enabled ? 'Усыпить' : 'Разбудить'}">
                <input type="checkbox" data-toggle-agent="${agent.agent_id}" ${agent.enabled ? 'checked' : ''}>
                <span class="swarm-switch__track"></span>
            </label>
        </li>`;
}

function renderSwarmAgentList() {
    const list = document.getElementById('swarm-agent-list');
    if (!list || list.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    const agents = Object.values(swarmState.agents);
    const council = agents.filter(a => a.groups.includes('council'))
        .sort((a, b) => Number(b.chair) - Number(a.chair));
    const home = agents.filter(a => !a.groups.length);
    list.innerHTML = `
        <section class="swarm-modal__section">
            <h3>Совет</h3>
            <p class="swarm-settings__hint">Участники обсуждают каждое событие независимо, каждый на своей модели. Консул ведёт раунды и раздаёт задачи агентам по очереди.</p>
            <ul class="swarm-agent-list">${council.map(renderSwarmAgentRow).join('')}</ul>
        </section>
        <section class="swarm-modal__section">
            <h3>Агенты дома</h3>
            <ul class="swarm-agent-list">${home.map(renderSwarmAgentRow).join('')}</ul>
        </section>`;
    swarmIcons(list);
}

function renderSwarmSettings(force) {
    const control = swarmState.control;
    const form = document.getElementById('swarm-settings-form');
    if (!control || (!force && form.contains(document.activeElement))) return;
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
    swarmIcons(list);
    // What the swarm chose to keep for today (ARCHIE-246); cleared at midnight.
    const today = swarmState.control ? swarmState.control.today : [];
    document.getElementById('swarm-today').innerHTML = today.length
        ? today.map(fact => `<li class="swarm-fact"><span>${swarmEscape(fact)}</span></li>`).join('')
        : '<li class="swarm-fact swarm-fact--empty">Рой ещё ничего не отложил на сегодня.</li>';
    document.querySelector('[data-memory-tab="lasting"] span').textContent = facts.length;
    document.querySelector('[data-memory-tab="today"] span').textContent = today.length;
    showSwarmMemoryTab(swarmState.memoryTab);
}

function showSwarmMemoryTab(tab) {
    swarmState.memoryTab = tab;
    document.querySelectorAll('[data-memory-tab]').forEach(button => {
        button.classList.toggle('swarm-tab--active', button.dataset.memoryTab === tab);
    });
    document.getElementById('swarm-memory').classList.toggle('hidden', tab !== 'lasting');
    document.getElementById('swarm-today').classList.toggle('hidden', tab !== 'today');
    document.getElementById('swarm-memory-hint').textContent = tab === 'today'
        ? 'Рой сам решает, что отложить на день, и очищает это в полночь.'
        : 'Попадает в каждый промпт роя. Скажи «запомни…», чтобы добавить.';
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
    const settings = readSwarmSettings(e.target);
    const error = document.getElementById('swarm-settings-error');
    if (!(settings.interval_min_minutes >= 1 && settings.interval_max_minutes <= 60
        && settings.interval_min_minutes <= settings.interval_max_minutes)) {
        error.textContent = 'Интервал: от 1 до 60 минут, минимум не больше максимума.';
        return;
    }
    error.textContent = '';
    swarmSend({ type: 'update_settings', settings });
    const saved = document.getElementById('swarm-settings-saved');
    saved.classList.remove('hidden');
    setTimeout(() => saved.classList.add('hidden'), 2000);
}

function swarmTimeInput(name) {
    return `<input name="${name}" type="text" class="swarm-input swarm-input--time" pattern="${SWARM_TIME_PATTERN}"
                   maxlength="5" inputmode="numeric" placeholder="ЧЧ:ММ" required>`;
}

function swarmModalHtml() {
    return `
        <div id="swarm-modal" class="swarm-modal hidden" role="dialog" aria-modal="true" aria-labelledby="swarm-modal-title">
            <div class="swarm-modal__panel">
                <header class="swarm-modal__header">
                    <h2 id="swarm-modal-title"><i data-lucide="settings-2" class="w-5 h-5"></i> Настройки роя</h2>
                    <button type="button" class="swarm-icon-button" data-close-settings title="Закрыть (Esc)">
                        <i data-lucide="x" class="w-5 h-5"></i></button>
                </header>
                <nav class="swarm-modal__tabs" role="tablist">${Object.entries(SWARM_SETTINGS_TABS).map(([tab, name]) => `
                    <button type="button" role="tab" class="swarm-modal__tab" data-settings-tab="${tab}">${name}</button>`).join('')}
                </nav>
                <div class="swarm-modal__body">
                    <div data-settings-panel="agents" id="swarm-agent-list"></div>
                    <form data-settings-panel="checks" id="swarm-settings-form" class="swarm-settings__form hidden">
                        <section class="swarm-modal__section">
                            <h3>Проверки</h3>
                            <p class="swarm-settings__hint">Рой просыпается через случайную паузу и проверяет одну область.</p>
                            <div class="swarm-field">
                                <span>Пауза, мин</span>
                                <span class="swarm-field__pair">
                                    <input name="interval_min_minutes" type="number" min="1" max="60" class="swarm-input swarm-input--number" required> –
                                    <input name="interval_max_minutes" type="number" min="1" max="60" class="swarm-input swarm-input--number" required></span>
                            </div>
                            <div class="swarm-field">
                                <span>Работают</span>
                                <span class="swarm-field__pair">${swarmTimeInput('active_from')} – ${swarmTimeInput('active_until')}</span>
                            </div>
                            <div class="swarm-chips">${Object.entries(SWARM_TASKS).map(([task, name]) => `
                                <label class="swarm-check-chip"><input type="checkbox" name="tasks" value="${task}"><span>${name}</span></label>`).join('')}
                            </div>
                            <label class="swarm-field swarm-field--stack">
                                <span>Команды</span>
                                <input name="football_teams" type="text" class="swarm-input" placeholder="пусто — команды из футбольного скилла">
                            </label>
                        </section>
                        <section class="swarm-modal__section">
                            <h3>Голос</h3>
                            <div class="swarm-field"><span>Будни с</span>${swarmTimeInput('voice_from_weekday')}</div>
                            <div class="swarm-field"><span>Выходные с</span>${swarmTimeInput('voice_from_weekend')}</div>
                            <div class="swarm-field"><span>До</span>${swarmTimeInput('voice_until')}</div>
                        </section>
                        <footer class="swarm-modal__footer">
                            <span id="swarm-settings-error" class="swarm-settings__error"></span>
                            <span id="swarm-settings-saved" class="swarm-settings__saved hidden">Сохранено</span>
                            <button type="submit" class="swarm-button">Сохранить</button>
                        </footer>
                    </form>
                    <div data-settings-panel="memory" class="hidden">
                        <section class="swarm-modal__section">
                            <div class="swarm-tabs">
                                <button type="button" class="swarm-tab" data-memory-tab="lasting">Постоянная <span>0</span></button>
                                <button type="button" class="swarm-tab" data-memory-tab="today">Сегодня <span>0</span></button>
                            </div>
                            <p id="swarm-memory-hint" class="swarm-settings__hint"></p>
                            <ul id="swarm-memory" class="swarm-memory"></ul>
                            <ul id="swarm-today" class="swarm-memory hidden"></ul>
                        </section>
                    </div>
                </div>
            </div>
        </div>`;
}

// --- Events ---

function setSwarmAgents(agents) {
    swarmState.agents = Object.fromEntries(agents.map(agent => [agent.agent_id, agent]));
    renderSwarmCrew();
    renderSwarmAgentList();
}

function handleSwarmEvent(event) {
    if (event.type === 'history') {
        swarmState.models = event.models || [];
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
        // Plan steps show a spinner while their agent works.
        if (swarmState.messages.some(m => m.kind === 'task')) renderSwarmFeed();
    } else if (event.type === 'agents') {
        setSwarmAgents(event.agents);
    } else if (event.type === 'control') {
        swarmState.control = event;
        renderSwarmControls();
        renderSwarmSettings(false);
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
        icon: 'users',
        description: `группа: ${members.map(m => '@' + m.agent_id).join(', ')}`,
    }));
    const options = match
        ? [...Object.values(swarmState.agents), ...groupOptions]
            .filter(a => a.agent_id.startsWith(match[1].toLowerCase()))
        : [];
    box.innerHTML = options.map(agent => `
        <button type="button" class="swarm-suggestion" data-agent-id="${agent.agent_id}" style="--agent-color:${agent.color}">
            <i data-lucide="${agent.icon}" class="w-3.5 h-3.5"></i> @${agent.agent_id} <span>${swarmEscape(agent.description)}</span>
        </button>`).join('');
    box.classList.toggle('hidden', options.length === 0);
    swarmIcons(box);
}

function insertSwarmMention(agentId) {
    const input = document.getElementById('swarm-input');
    const before = input.value.slice(0, input.selectionStart).replace(/@([a-z0-9_]*)$/i, `@${agentId} `);
    input.value = before + input.value.slice(input.selectionStart);
    input.focus();
    input.setSelectionRange(before.length, before.length);
    updateSwarmSuggestions();
}

function bindSwarmModal() {
    const modal = document.getElementById('swarm-modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-close-settings]')) closeSwarmSettings();
        const tab = e.target.closest('[data-settings-tab]');
        if (tab) showSwarmSettingsTab(tab.dataset.settingsTab);
        const memoryTab = e.target.closest('[data-memory-tab]');
        if (memoryTab) showSwarmMemoryTab(memoryTab.dataset.memoryTab);
        const forget = e.target.closest('[data-fact-id]');
        if (forget) swarmSend({ type: 'forget', fact_id: forget.dataset.factId });
        const reset = e.target.closest('[data-reset-model]');
        if (reset) swarmSend({ type: 'set_agent_model', agent_id: reset.dataset.resetModel, model: null });
    });
    modal.addEventListener('change', (e) => {
        const toggle = e.target.closest('[data-toggle-agent]');
        if (toggle) swarmSend({ type: 'toggle_agent', agent_id: toggle.dataset.toggleAgent, enabled: toggle.checked });
        const select = e.target.closest('[data-model-agent]');
        if (select) {
            swarmSend({ type: 'set_agent_model', agent_id: select.dataset.modelAgent, model: select.value });
            select.blur();
        }
    });
    document.getElementById('swarm-settings-form').addEventListener('submit', saveSwarmSettings);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeSwarmSettings();
    });
}

function initSwarmChat() {
    const root = document.getElementById('swarm-root');
    if (!root) return;
    root.innerHTML = `
        <header class="swarm__header">
            <div class="swarm__top">
                <div class="swarm__title">
                    <i data-lucide="messages-square" class="w-5 h-5"></i>
                    <span>Рой агентов</span>
                    <span id="swarm-status" class="swarm__status hidden"></span>
                </div>
                <div class="swarm__controls">
                    <div class="swarm-segmented" role="group" aria-label="Режим роя">
                        <button type="button" class="swarm-mode" data-swarm-mode="running" title="Проверки и чат">
                            <i data-lucide="play" class="w-4 h-4"></i><span>Play</span></button>
                        <button type="button" class="swarm-mode" data-swarm-mode="paused" title="Без проверок, чат работает">
                            <i data-lucide="pause" class="w-4 h-4"></i><span>Pause</span></button>
                        <button type="button" class="swarm-mode swarm-mode--stop" data-swarm-mode="stopped" title="Выключить рой и очистить чат">
                            <i data-lucide="square" class="w-4 h-4"></i><span>Stop</span></button>
                    </div>
                    <button type="button" class="swarm-icon-button" data-open-settings title="Настройки роя">
                        <i data-lucide="settings-2" class="w-5 h-5"></i></button>
                </div>
            </div>
            <div class="swarm__sub">
                <div id="swarm-crew" class="swarm-crew"></div>
                <div id="swarm-schedule" class="swarm__schedule"></div>
            </div>
        </header>
        <div id="swarm-feed" class="swarm__feed"></div>
        <div id="swarm-typing" class="swarm__typing"></div>
        <form id="swarm-form" class="swarm__form">
            <div id="swarm-suggestions" class="swarm__suggestions hidden"></div>
            <input id="swarm-input" class="swarm__input" maxlength="600" autocomplete="off"
                   placeholder="Напиши рою… @ — упомянуть агента">
            <button type="submit" class="swarm__send" title="Отправить"><i data-lucide="send" class="w-5 h-5"></i></button>
        </form>`;
    // The modal lives in <body>: no parent clips or blurs it.
    document.body.insertAdjacentHTML('beforeend', swarmModalHtml());
    swarmIcons(root);
    swarmIcons(document.getElementById('swarm-modal'));

    document.querySelectorAll('[data-swarm-mode]').forEach(button => {
        button.addEventListener('click', () => setSwarmMode(button.dataset.swarmMode));
    });
    root.querySelector('.swarm__header').addEventListener('click', (e) => {
        const open = e.target.closest('[data-open-settings]');
        if (open) openSwarmSettings(open.dataset.openSettings);
    });
    bindSwarmModal();
    document.getElementById('swarm-feed').addEventListener('click', (e) => {
        const check = e.target.closest('.swarm-msg--check');
        if (check) check.classList.toggle('swarm-msg--open');
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
    closeSwarmSettings();
    swarmState.active = false;
    disconnectSwarm();
}

window.showSwarmView = showSwarmView;
window.hideSwarmView = hideSwarmView;

document.addEventListener('DOMContentLoaded', initSwarmChat);
