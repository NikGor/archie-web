// Agent constructor (ARCHIE-343): build an agent system along the five
// dimensions of the Solaris research, edit every agent, see the validator,
// run it (demo or real tools) and save it to the library.
// Data: Django /agent-constructor/api/ (proxy to the agent /agent-systems).
// The agent decides what is valid and what can run: the catalog marks every
// unavailable option with its reason, the validator returns every error.
// Shared helpers from PromptEvals.js: peEscape, peFormatDate.

const AC_API = '/agent-constructor/api';
const AC_POLL_MS = 1500;
const AC_POLL_RETRIES = 10;
const AC_VALIDATE_DELAY_MS = 500;
const AC_TABS = [
    ['build', 'blocks', 'Конструктор'],
    ['library', 'library', 'Библиотека'],
    ['runs', 'history', 'Запуски'],
    ['theory', 'book-open', 'Теория'],
];
const AC_ROLE_LABELS = {
    agent: 'Агент', supervisor: 'Supervisor', worker: 'Worker', peer: 'Peer', aggregator: 'Агрегатор',
};
const AC_PROTOCOL_LABELS = {
    independent: 'Независимо', debate: 'Дебаты', vote: 'Голосование',
};
const AC_PROTOCOL_HINTS = {
    independent: 'Peers решают независимо, агрегатор сводит результаты',
    debate: 'Peers видят выводы друг друга и исправляют свои',
    vote: 'Каждый peer — один голос; агрегатор выбирает ответ большинства',
};
const AC_STATE_LABELS = {
    running: 'Идёт', completed: 'Готово', failed: 'Ошибка', cancelled: 'Отменён',
    waiting_for_approval: 'Ждёт подтверждения', created: 'Создан', configured: 'Сконфигурирован',
};
const AC_PHASE_LABELS = {
    run: 'запуск', step: 'шаг', plan: 'план', work: 'работа', synthesis: 'синтез',
    aggregate: 'агрегация',
};
const AC_EVENT_LABELS = {
    system_started: 'Система запущена', node_configured: 'Конфигуратор собрал агента',
    step_started: 'Шаг начат', step_finished: 'Шаг завершён', system_completed: 'Система завершена',
    system_failed: 'Система остановлена', system_cancelled: 'Отменено',
};
// Research map: X = decentralization of decisions, Y = operational autonomy
const AC_DECENTRALIZATION = { centralized: 0.12, workflow: 0.35, hierarchical: 0.55, decentralized: 0.88 };
const AC_TOPOLOGY_ICONS = {
    centralized: 'circle-dot', workflow: 'git-branch', hierarchical: 'network', decentralized: 'share-2',
};

const acState = {
    active: false,
    tab: 'build',
    catalog: null,
    spec: null,
    title: '',
    task: '',
    demo: true,
    systemId: null,
    revision: null,
    scheduleJobId: '',
    selected: null,
    check: null,
    checking: false,
    composing: false,
    composeTopology: '',
    composeReason: '',
    run: null,
    agentRuns: {},
    openStep: null,
    runs: [],
    systems: [],
    showJson: false,
    error: null,
    notice: null,
    pollTimer: null,
    validateTimer: null,
};

// --- API ---

async function acFetch(path, options = {}) {
    const response = await fetch(`${AC_API}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken'), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

function acPost(path, body, method = 'POST') {
    return acFetch(path, { method, body: JSON.stringify(body) });
}

function acSetError(error) {
    acState.error = error ? String(error.message || error) : null;
    acRenderMessages();
}

function acNotify(text) {
    acState.notice = text;
    acRenderMessages();
    setTimeout(() => { if (acState.notice === text) { acState.notice = null; acRenderMessages(); } }, 4000);
}

// --- Spec model ---

function acDimension(name) {
    return acState.catalog.dimensions.find(d => d.name === name);
}

function acTool(name) {
    return acState.catalog.tools.find(t => t.name === name);
}

function acNeedsApproval(name) {
    const tool = acTool(name);
    return tool && tool.effect === 'write';
}

function acSlug(text, fallback) {
    const slug = String(text || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 32);
    return slug || fallback;
}

function acNewAgent(name, role = 'Исследователь', purpose = 'Найти и проверить факты по задаче') {
    return {
        identity: { name, role, purpose },
        objective: { task: 'Задача системы', completion_criteria: ['Результат подтверждён данными tools'] },
        instructions: '',
        model: { profile: 'BALANCED', effort: 'medium', reason: '' },
        tools: ['google_search_tool'],
        skills: [],
        context: { facts: [], memory: 'none' },
        execution: { max_iterations: 3, max_tool_calls: 6, timeout_seconds: 120, retries: 1 },
        budget: { max_cost_usd: 0.05 },
        permissions: { mode: 'read_only', approval_tools: [] },
        output: { schema_name: 'findings_v1' },
    };
}

function acNewNode(id, role) {
    return { id, role, step: '', depends_on: [], spec: acNewAgent(id) };
}

function acNewSystem(topology = 'centralized') {
    const spec = {
        system_version: '1',
        name: 'new_system',
        description: '',
        topology: 'centralized',
        activation: 'reactive',
        lifecycle: 'ephemeral',
        dynamism: 'configurable',
        autonomy: { plan: true, external_actions: 'none', set_goals: false, spawn_agents: false },
        coordination: { protocol: 'independent', debate_rounds: 1 },
        nodes: [acNewNode('main', 'agent')],
        task: '',
        schedule: null,
        budget: { max_cost_usd: 0.3, max_seconds: 300 },
    };
    acApplyTopology(spec, topology);
    return spec;
}

// Keep the nodes, give them roles and links that fit the new topology
function acApplyTopology(spec, topology) {
    spec.topology = topology;
    let nodes = spec.nodes;
    const fresh = (prefix, role) => {
        let index = 1;
        while (nodes.some(n => n.id === `${prefix}${index}`)) index += 1;
        return acNewNode(`${prefix}${index}`, role);
    };
    if (topology === 'centralized') {
        nodes = [nodes[0]];
        nodes[0].role = 'agent';
    } else if (topology === 'workflow') {
        if (nodes.length < 2) nodes.push(fresh('step', 'agent'));
        nodes.forEach((n, i) => { n.role = 'agent'; n.depends_on = i ? [nodes[i - 1].id] : []; });
    } else if (topology === 'hierarchical') {
        if (nodes.length < 2) nodes.push(fresh('worker', 'worker'));
        nodes.forEach((n, i) => { n.role = i ? 'worker' : 'supervisor'; n.depends_on = []; });
        nodes = nodes.slice(0, 1 + acState.catalog.limits.max_workers);
    } else {
        while (nodes.length < 2) nodes.push(fresh('peer', 'peer'));
        nodes.forEach(n => { n.role = 'peer'; n.depends_on = []; });
        nodes = nodes.slice(0, acState.catalog.limits.max_peers);
        nodes.push(fresh('judge', 'aggregator'));
    }
    spec.nodes = nodes;
}

// Side effects need approval: the validator demands write tools in approval_tools
function acSyncPermissions(spec) {
    const propose = spec.autonomy.external_actions === 'propose';
    spec.nodes.forEach(node => {
        if (!node.spec) return;
        const writes = node.spec.tools.filter(acNeedsApproval);
        node.spec.permissions = propose && writes.length
            ? { mode: 'propose_actions', approval_tools: writes }
            : { mode: 'read_only', approval_tools: [] };
    });
}

function acPathGet(object, path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function acPathSet(object, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((value, key) => value[key], object);
    target[last] = value;
}

function acSelectedNode() {
    return acState.spec.nodes.find(n => n.id === acState.selected) || null;
}

function acSpecChanged({ structure = false } = {}) {
    acSyncPermissions(acState.spec);
    clearTimeout(acState.validateTimer);
    acState.validateTimer = setTimeout(acValidate, AC_VALIDATE_DELAY_MS);
    if (structure) acRenderBuild();
}

async function acValidate() {
    if (!acState.spec) return;
    acState.checking = true;
    try {
        acState.check = await acPost('/validate/', { spec: acState.spec });
    } catch (error) {
        acState.check = { valid: false, errors: [String(error.message || error)], warnings: [], adjustments: [] };
    }
    acState.checking = false;
    acRenderPart('ac-check', acCheckHtml);
    acRenderPart('ac-run-panel', acRunPanelHtml);
}

// --- Rendering ---

function acRenderPart(id, render) {
    const element = document.getElementById(id);
    if (!element) return;
    element.innerHTML = render();
    lucide.createIcons({ nodes: [element] });
}

function acRenderMessages() {
    acRenderPart('ac-messages', () => [
        acState.error ? `<div class="pe-error">${peEscape(acState.error)}</div>` : '',
        acState.notice ? `<div class="ac-notice">${peEscape(acState.notice)}</div>` : '',
    ].join(''));
}

function acRender() {
    const root = document.getElementById('constructor-root');
    if (!root) return;
    root.innerHTML = `
        <div class="pe__header">
            <div class="pe__title"><i data-lucide="blocks" class="w-5 h-5"></i> Конструктор агентов</div>
            <div class="pe__tabs">
                ${AC_TABS.map(([key, icon, label]) => `
                    <button class="pe-tab ${acState.tab === key ? 'pe-tab--active' : ''}" data-ac-tab="${key}">
                        <i data-lucide="${icon}" class="w-4 h-4"></i>${label}
                    </button>`).join('')}
            </div>
        </div>
        <div id="ac-messages"></div>
        <div class="pe__body" id="ac-body"></div>`;
    lucide.createIcons({ nodes: [root] });
    acRenderMessages();
    acRenderBody();
}

function acRenderBody() {
    if (!acState.catalog) {
        acRenderPart('ac-body', () => '<div class="pe-empty">Загрузка каталога агента…</div>');
        return;
    }
    if (acState.tab === 'library') acRenderPart('ac-body', acLibraryHtml);
    else if (acState.tab === 'runs') acRenderPart('ac-body', acRunsHtml);
    else if (acState.tab === 'theory') acRenderPart('ac-body', acTheoryHtml);
    else acRenderBuild();
}

function acRenderBuild() {
    if (acState.tab !== 'build') return;
    acRenderPart('ac-body', () => `
        <div class="ac-grid">
            <div class="ac-col">
                ${acTaskHtml()}
                <section class="ac-card"><div id="ac-dimensions">${acDimensionsHtml()}</div></section>
            </div>
            <div class="ac-col ac-col--wide">
                <section class="ac-card">
                    <div class="ac-card__head">
                        <h3><i data-lucide="${AC_TOPOLOGY_ICONS[acState.spec.topology]}" class="w-4 h-4"></i> Схема</h3>
                        <div class="ac-actions">${acAddNodeHtml()}</div>
                    </div>
                    <div id="ac-diagram">${acDiagramHtml()}</div>
                </section>
                <section class="ac-card" id="ac-editor">${acEditorHtml()}</section>
                <section class="ac-card" id="ac-check">${acCheckHtml()}</section>
                <section class="ac-card" id="ac-run-panel">${acRunPanelHtml()}</section>
                ${acJsonHtml()}
            </div>
        </div>`);
}

function acTaskHtml() {
    const topologies = acDimension('topology').options;
    return `
        <section class="ac-card">
            <div class="ac-card__head">
                <h3><i data-lucide="sparkles" class="w-4 h-4"></i> Система</h3>
                <div class="ac-actions">
                    <button class="pe-btn pe-btn--small" data-ac-action="new" title="Новая система с нуля"><i data-lucide="file-plus" class="w-3.5 h-3.5"></i>Новая</button>
                    <button class="pe-btn pe-btn--small" data-ac-action="save" title="Сохранить в библиотеку"><i data-lucide="save" class="w-3.5 h-3.5"></i>${acState.systemId ? 'Сохранить' : 'В библиотеку'}</button>
                    ${acState.systemId ? '<button class="pe-btn pe-btn--small" data-ac-action="save-copy" title="Сохранить как новую"><i data-lucide="copy-plus" class="w-3.5 h-3.5"></i></button>' : ''}
                </div>
            </div>
            <label class="pe-field">Название
                <input class="pe-input" data-ac-field="title" value="${peEscape(acState.title)}" placeholder="Например: Диагностика расхода энергии">
            </label>
            <label class="pe-field">Задача
                <textarea class="pe-input pe-textarea" rows="3" data-ac-field="task" placeholder="Что должна сделать система">${peEscape(acState.task)}</textarea>
            </label>
            <div class="ac-row">
                <select class="pe-input" data-ac-field="composeTopology" title="Топология для композитора">
                    <option value="">Топологию выберет композитор</option>
                    ${topologies.map(o => `<option value="${o.value}" ${acState.composeTopology === o.value ? 'selected' : ''}>${peEscape(o.label)}</option>`).join('')}
                </select>
                <button class="pe-btn" data-ac-action="compose" ${acState.composing ? 'disabled' : ''}>
                    <i data-lucide="${acState.composing ? 'loader-2' : 'wand-sparkles'}" class="w-4 h-4 ${acState.composing ? 'ac-spin' : ''}"></i>
                    ${acState.composing ? 'Композитор думает…' : 'Предложить архитектуру'}
                </button>
            </div>
            ${acState.composeReason ? `<p class="ac-reason"><i data-lucide="message-square-quote" class="w-3.5 h-3.5"></i> ${peEscape(acState.composeReason)}</p>` : ''}
            <label class="pe-field">Имя системы (slug)
                <input class="pe-input" data-ac-spec="name" value="${peEscape(acState.spec.name)}">
            </label>
        </section>`;
}

function acOptionChips(dimension, current, attribute) {
    return `<div class="ac-chips">${dimension.options.map(option => `
        <button class="pe-chip pe-chip--btn ac-chip ${option.value === current ? 'pe-chip--on' : ''} ${option.available ? '' : 'ac-chip--locked'}"
            ${option.available ? `${attribute}="${dimension.name}:${option.value}"` : 'disabled'}
            title="${peEscape(option.available ? option.description : `Недоступно: ${option.reason}`)}">
            ${option.available ? '' : '<i data-lucide="lock" class="w-3 h-3"></i>'}${peEscape(option.label)}
        </button>`).join('')}</div>`;
}

function acDimensionsHtml() {
    const spec = acState.spec;
    const rows = ['topology', 'activation', 'lifecycle', 'dynamism'].map(name => {
        const dimension = acDimension(name);
        const option = dimension.options.find(o => o.value === spec[name]);
        return `
            <div class="ac-dim">
                <div class="ac-dim__head"><b>${peEscape(dimension.label)}</b><span class="pe-muted">${peEscape(dimension.question)}</span></div>
                ${acOptionChips(dimension, spec[name], 'data-ac-dim')}
                <div class="ac-dim__hint">${peEscape(option ? option.description : '')}</div>
                ${name === 'topology' && spec.topology === 'decentralized' ? acCoordinationHtml() : ''}
                ${name === 'activation' && spec.activation === 'scheduled' ? acScheduleHtml() : ''}
            </div>`;
    }).join('');
    return `
        <div class="ac-card__head"><h3><i data-lucide="axis-3d" class="w-4 h-4"></i> Пять измерений</h3></div>
        ${rows}
        ${acAutonomyHtml()}
        <div class="ac-dim">
            <div class="ac-dim__head"><b>Бюджет системы</b><span class="pe-muted">на один запуск, потолок $${acState.catalog.limits.system_max_cost_usd}</span></div>
            <div class="ac-row">
                <label class="pe-field pe-field--inline">$ <input class="pe-input pe-input--short" type="number" step="0.01" min="0.01" data-ac-spec="budget.max_cost_usd" data-ac-type="number" value="${spec.budget.max_cost_usd}"></label>
                <label class="pe-field pe-field--inline">сек <input class="pe-input pe-input--short" type="number" step="10" min="10" data-ac-spec="budget.max_seconds" data-ac-type="number" value="${spec.budget.max_seconds}"></label>
            </div>
        </div>
        ${acMapHtml()}`;
}

function acCoordinationHtml() {
    const coordination = acState.spec.coordination;
    return `
        <div class="ac-sub">
            <div class="ac-chips">${Object.entries(AC_PROTOCOL_LABELS).map(([value, label]) => `
                <button class="pe-chip pe-chip--btn ${coordination.protocol === value ? 'pe-chip--on' : ''}" data-ac-protocol="${value}" title="${AC_PROTOCOL_HINTS[value]}">${label}</button>`).join('')}
            </div>
            <div class="ac-dim__hint">${AC_PROTOCOL_HINTS[coordination.protocol]}</div>
            ${coordination.protocol === 'debate' ? `
                <label class="pe-field pe-field--inline">Раундов дебатов
                    <select class="pe-input pe-input--short" data-ac-spec="coordination.debate_rounds" data-ac-type="number" data-ac-structure="1">
                        ${[1, 2].map(n => `<option ${coordination.debate_rounds === n ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                </label>` : ''}
        </div>`;
}

function acScheduleHtml() {
    const schedule = acState.spec.schedule || { cron: '0 * * * *', timezone: acState.catalog.timezone };
    acState.spec.schedule = schedule;
    return `
        <div class="ac-sub ac-row">
            <label class="pe-field">Cron <input class="pe-input" data-ac-spec="schedule.cron" value="${peEscape(schedule.cron)}" placeholder="0 8 * * *"></label>
            <label class="pe-field">Часовой пояс <input class="pe-input" data-ac-spec="schedule.timezone" value="${peEscape(schedule.timezone)}"></label>
        </div>
        <div class="ac-dim__hint">По расписанию запускается задача из поля «Задача» в сохранённой версии системы.</div>`;
}

function acAutonomyHtml() {
    const autonomy = acState.spec.autonomy;
    const on = {
        choose_tools: true,
        plan: autonomy.plan,
        propose: autonomy.external_actions === 'propose',
        execute: false,
        set_goals: autonomy.set_goals,
        spawn_agents: autonomy.spawn_agents,
    };
    return `
        <div class="ac-dim">
            <div class="ac-dim__head"><b>Автономность</b><span class="pe-muted">отдельные полномочия, а не шкала</span></div>
            <div class="ac-chips">${acState.catalog.autonomy.map(power => {
                const locked = !power.available || power.value === 'choose_tools';
                return `<button class="pe-chip pe-chip--btn ac-chip ${on[power.value] ? 'pe-chip--on' : ''} ${power.available ? '' : 'ac-chip--locked'}"
                    ${locked ? 'disabled' : `data-ac-power="${power.value}"`}
                    title="${peEscape(power.available ? power.description : `Недоступно: ${power.reason}`)}">
                    ${power.available ? '' : '<i data-lucide="lock" class="w-3 h-3"></i>'}${peEscape(power.label)}</button>`;
            }).join('')}</div>
            <div class="ac-dim__hint">${on.propose
                ? 'Write-tools агентов становятся предложениями на подтверждение; ничего не исполняется.'
                : 'Только чтение: агентам нельзя выбирать tools с побочными эффектами.'}</div>
        </div>`;
}

function acAutonomyScore() {
    const autonomy = acState.spec.autonomy;
    return (1 + (autonomy.plan ? 1 : 0) + (autonomy.external_actions === 'propose' ? 1 : 0)) / 6;
}

function acMapHtml() {
    const x = AC_DECENTRALIZATION[acState.spec.topology];
    const y = acAutonomyScore();
    const width = 220;
    const height = 120;
    return `
        <div class="ac-dim">
            <div class="ac-dim__head"><b>Карта</b><span class="pe-muted">для обсуждения, не калиброванная оценка</span></div>
            <svg class="ac-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Децентрализация и автономность">
                <rect x="28" y="6" width="${width - 34}" height="${height - 30}" class="ac-map__area"/>
                ${[0.25, 0.5, 0.75].map(t => `<line x1="${28 + t * (width - 34)}" y1="6" x2="${28 + t * (width - 34)}" y2="${height - 24}" class="ac-map__grid"/>`).join('')}
                <circle cx="${28 + x * (width - 34)}" cy="${6 + (1 - y) * (height - 30)}" r="6" class="ac-map__dot"/>
                <text x="${28 + (width - 34) / 2}" y="${height - 8}" class="ac-map__label" text-anchor="middle">децентрализация решений →</text>
                <text x="12" y="${(height - 24) / 2}" class="ac-map__label" text-anchor="middle" transform="rotate(-90 12 ${(height - 24) / 2})">автономность →</text>
            </svg>
        </div>`;
}

function acAddNodeHtml() {
    const spec = acState.spec;
    if (spec.topology === 'centralized') return '';
    const roles = acState.catalog.topology_roles[spec.topology];
    const full = spec.nodes.length >= acState.catalog.limits.max_nodes;
    return roles.map(role => `
        <button class="pe-btn pe-btn--small" data-ac-add="${role}" ${full ? 'disabled' : ''} title="Добавить: ${AC_ROLE_LABELS[role]}">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>${AC_ROLE_LABELS[role]}
        </button>`).join('');
}

// Layout: rows of nodes; edges drawn in SVG under the boxes
function acLayout(spec) {
    const nodes = spec.nodes;
    if (spec.topology === 'workflow') {
        const level = {};
        const depth = node => {
            if (level[node.id] !== undefined) return level[node.id];
            level[node.id] = 0;
            const parents = node.depends_on.map(id => nodes.find(n => n.id === id)).filter(Boolean);
            level[node.id] = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
            return level[node.id];
        };
        nodes.forEach(depth);
        const columns = [];
        nodes.forEach(n => { (columns[level[n.id]] = columns[level[n.id]] || []).push(n.id); });
        return {
            direction: 'columns',
            groups: columns.filter(Boolean),
            edges: nodes.flatMap(n => n.depends_on.filter(d => nodes.some(m => m.id === d)).map(d => [d, n.id])),
        };
    }
    if (spec.topology === 'hierarchical') {
        const boss = nodes.filter(n => n.role === 'supervisor').map(n => n.id);
        const workers = nodes.filter(n => n.role !== 'supervisor').map(n => n.id);
        return { direction: 'rows', groups: [boss, workers], edges: boss.flatMap(b => workers.map(w => [b, w])) };
    }
    if (spec.topology === 'decentralized') {
        const peers = nodes.filter(n => n.role === 'peer').map(n => n.id);
        const judges = nodes.filter(n => n.role !== 'peer').map(n => n.id);
        const mesh = spec.coordination.protocol === 'debate'
            ? peers.flatMap((a, i) => peers.slice(i + 1).map(b => [a, b, 'mesh'])) : [];
        return { direction: 'rows', groups: [peers, judges], edges: [...mesh, ...peers.flatMap(p => judges.map(j => [p, j]))] };
    }
    return { direction: 'rows', groups: [[nodes[0].id]], edges: [] };
}

function acDiagramHtml() {
    const spec = acState.spec;
    const layout = acLayout(spec);
    const boxWidth = 150;
    const boxHeight = 62;
    const gapX = 40;
    const gapY = 46;
    const positions = {};
    const groups = layout.groups.filter(g => g.length);
    const longest = Math.max(...groups.map(g => g.length));
    const span = layout.direction === 'columns'
        ? { width: groups.length * (boxWidth + gapX) - gapX, height: longest * (boxHeight + 18) - 18 }
        : { width: longest * (boxWidth + gapX) - gapX, height: groups.length * (boxHeight + gapY) - gapY };
    groups.forEach((group, g) => {
        group.forEach((id, i) => {
            if (layout.direction === 'columns') {
                const offset = (span.height - (group.length * (boxHeight + 18) - 18)) / 2;
                positions[id] = { x: g * (boxWidth + gapX), y: offset + i * (boxHeight + 18) };
            } else {
                const offset = (span.width - (group.length * (boxWidth + gapX) - gapX)) / 2;
                positions[id] = { x: offset + i * (boxWidth + gapX), y: g * (boxHeight + gapY) };
            }
        });
    });
    const edges = layout.edges.map(([from, to, kind]) => {
        const a = positions[from];
        const b = positions[to];
        if (!a || !b) return '';
        if (kind === 'mesh') {
            const y = a.y + boxHeight / 2;
            return `<path d="M${a.x + boxWidth} ${y} L${b.x} ${y}" class="ac-edge ac-edge--mesh"/>`;
        }
        const [x1, y1, x2, y2] = layout.direction === 'columns'
            ? [a.x + boxWidth, a.y + boxHeight / 2, b.x, b.y + boxHeight / 2]
            : [a.x + boxWidth / 2, a.y + boxHeight, b.x + boxWidth / 2, b.y];
        return `<path d="M${x1} ${y1} L${x2} ${y2}" class="ac-edge" marker-end="url(#ac-arrow)"/>`;
    }).join('');
    const run = acState.run;
    const boxes = spec.nodes.map(node => {
        const p = positions[node.id];
        if (!p) return '';
        const steps = run ? run.steps.filter(s => s.node_id === node.id) : [];
        const last = steps[steps.length - 1];
        const live = run && run.state === 'running' && run.events.some(e => e.kind === 'step_started' && e.detail.node === node.id)
            && (!last || run.events.filter(e => e.kind === 'step_started' && e.detail.node === node.id).length > steps.length);
        const status = live ? 'running' : last ? last.state : '';
        const agentSpec = node.spec || (run && run.configured[node.id]);
        return `
            <button class="ac-node ac-node--${node.role} ${acState.selected === node.id ? 'ac-node--selected' : ''} ${status ? `ac-node--${status}` : ''}"
                style="left:${p.x}px;top:${p.y}px;width:${boxWidth}px;height:${boxHeight}px" data-ac-select="${node.id}">
                <span class="ac-node__role">${AC_ROLE_LABELS[node.role]}${status ? ` · ${AC_STATE_LABELS[status] || status}` : ''}</span>
                <span class="ac-node__id">${peEscape(node.id)}</span>
                <span class="ac-node__meta">${agentSpec
                    ? `${agentSpec.model.profile} · ${agentSpec.tools.length} tools`
                    : '<i>соберёт конфигуратор</i>'}</span>
            </button>`;
    }).join('');
    return `
        <div class="ac-diagram" style="height:${span.height + 8}px">
            <div class="ac-diagram__canvas" style="width:${span.width}px;height:${span.height}px">
                <svg class="ac-diagram__edges" width="${span.width}" height="${span.height}">
                    <defs><marker id="ac-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="ac-arrow"/></marker></defs>
                    ${edges}
                </svg>
                ${boxes}
            </div>
        </div>
        <div class="pe-muted">Нажмите на узел, чтобы редактировать агента.${spec.topology === 'workflow' ? ' Шаги без зависимостей между собой выполняются параллельно.' : ''}</div>`;
}

function acEditorHtml() {
    const node = acSelectedNode();
    if (!node) return '<div class="pe-muted">Выберите узел на схеме.</div>';
    const spec = acState.spec;
    const roles = acState.catalog.topology_roles[spec.topology];
    const others = spec.nodes.filter(n => n.id !== node.id);
    const dynamic = spec.dynamism === 'dynamic';
    return `
        <div class="ac-card__head">
            <h3><i data-lucide="bot" class="w-4 h-4"></i> Узел ${peEscape(node.id)}</h3>
            <div class="ac-actions">
                ${spec.nodes.length > 1 && spec.topology !== 'centralized' ? '<button class="pe-btn pe-btn--small pe-btn--danger" data-ac-action="remove-node"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Удалить</button>' : ''}
            </div>
        </div>
        <div class="ac-row">
            <label class="pe-field">Id узла <input class="pe-input" data-ac-node-id value="${peEscape(node.id)}"></label>
            <label class="pe-field">Роль
                <select class="pe-input" data-ac-node="role" data-ac-structure="1">
                    ${roles.map(r => `<option value="${r}" ${node.role === r ? 'selected' : ''}>${AC_ROLE_LABELS[r]}</option>`).join('')}
                </select>
            </label>
        </div>
        <label class="pe-field">Шаг: что узел делает с задачей
            <textarea class="pe-input pe-textarea" rows="2" data-ac-node="step" placeholder="${node.role === 'supervisor' ? 'Supervisor сам раздаст подзадачи' : 'Например: собери данные о расходе по устройствам'}">${peEscape(node.step)}</textarea>
        </label>
        ${spec.topology === 'workflow' ? `
            <div class="pe-field">Получает результаты от
                <div class="ac-chips">${others.length ? others.map(o => `
                    <button class="pe-chip pe-chip--btn ${node.depends_on.includes(o.id) ? 'pe-chip--on' : ''}" data-ac-dep="${o.id}">${peEscape(o.id)}</button>`).join('') : '<span class="pe-muted">нет других шагов</span>'}
                </div>
            </div>` : ''}
        ${dynamic ? `
            <label class="ac-toggle"><input type="checkbox" data-ac-action="toggle-dynamic" ${node.spec ? '' : 'checked'}>
                Собрать агента конфигуратором при запуске</label>` : ''}
        ${node.spec ? acAgentFormHtml(node.spec) : '<p class="pe-muted">AgentSpec этого узла соберёт конфигуратор по шагу и задаче при каждом запуске.</p>'}`;
}

function acAgentFormHtml(agent) {
    const catalog = acState.catalog;
    const propose = acState.spec.autonomy.external_actions === 'propose';
    const profile = catalog.profiles.find(p => p.name === agent.model.profile);
    const field = (label, path, attrs = '', type = 'text') => `
        <label class="pe-field">${label}<input class="pe-input" type="${type}" data-ac-agent="${path}" ${type === 'number' ? 'data-ac-type="number"' : ''} ${attrs} value="${peEscape(acPathGet(agent, path))}"></label>`;
    return `
        <div class="ac-form">
            <div class="ac-row">
                ${field('Имя агента (slug)', 'identity.name')}
                ${field('Роль', 'identity.role')}
            </div>
            ${field('Назначение', 'identity.purpose')}
            <label class="pe-field">Критерии завершения — по одному в строке
                <textarea class="pe-input pe-textarea" rows="2" data-ac-agent="objective.completion_criteria" data-ac-type="lines">${peEscape(agent.objective.completion_criteria.join('\n'))}</textarea>
            </label>
            <label class="pe-field">Инструкции (бриф)
                <textarea class="pe-input pe-textarea" rows="3" data-ac-agent="instructions">${peEscape(agent.instructions)}</textarea>
            </label>
            <label class="pe-field">Факты для агента — по одному в строке
                <textarea class="pe-input pe-textarea" rows="2" data-ac-agent="context.facts" data-ac-type="lines">${peEscape(agent.context.facts.join('\n'))}</textarea>
            </label>
            <div class="pe-field">Профиль модели
                <div class="ac-chips">${catalog.profiles.map(p => `
                    <button class="pe-chip pe-chip--btn ${agent.model.profile === p.name ? 'pe-chip--on' : ''}" data-ac-agent-set="model.profile:${p.name}" title="${peEscape(p.models.join(' → '))}">${p.name}</button>`).join('')}
                </div>
                <span class="pe-muted">Модели профиля: ${peEscape(profile ? profile.models.join(' → ') : '—')}</span>
            </div>
            <div class="pe-field">Reasoning effort
                <div class="ac-chips">${catalog.efforts.map(e => `
                    <button class="pe-chip pe-chip--btn ${agent.model.effort === e ? 'pe-chip--on' : ''}" data-ac-agent-set="model.effort:${e}">${e}</button>`).join('')}
                </div>
            </div>
            <div class="pe-field">Tools
                <div class="ac-chips">${catalog.tools.map(t => {
                    const write = t.effect === 'write';
                    const blocked = write && !propose && !agent.tools.includes(t.name);
                    return `<button class="pe-chip pe-chip--btn ac-tool ${agent.tools.includes(t.name) ? 'pe-chip--on' : ''} ${write ? 'ac-tool--write' : ''}"
                        data-ac-tool="${t.name}" ${blocked ? 'disabled' : ''}
                        title="${peEscape(`${t.description}${write ? (t.read_actions.length ? ` · чтение: ${t.read_actions.join(', ')}; изменения — на подтверждение` : ' · изменения — только как предложение на подтверждение') : ''}${blocked ? ' · включите «Предлагать изменения» в автономности' : ''}`)}">
                        ${write ? '<i data-lucide="pencil" class="w-3 h-3"></i>' : ''}${t.name.replace(/_tool$/, '')}</button>`;
                }).join('')}</div>
                <span class="pe-muted">Права: ${agent.permissions.mode === 'propose_actions' ? `предлагать ${peEscape(agent.permissions.approval_tools.join(', '))}` : 'только чтение'}</span>
            </div>
            ${catalog.skills.length ? `
                <div class="pe-field">Skills
                    <div class="ac-chips">${catalog.skills.map(s => `
                        <button class="pe-chip pe-chip--btn ${agent.skills.includes(s.name) ? 'pe-chip--on' : ''}" data-ac-skill="${s.name}" title="${peEscape(s.description)}">${s.name}</button>`).join('')}
                    </div>
                </div>` : ''}
            <div class="pe-field">Схема результата
                <div class="ac-chips">${catalog.output_schemas.map(s => `
                    <button class="pe-chip pe-chip--btn ${agent.output.schema_name === s.name ? 'pe-chip--on' : ''}" data-ac-agent-set="output.schema_name:${s.name}" title="${peEscape(s.description)}">${s.name}</button>`).join('')}
                </div>
            </div>
            <div class="ac-row ac-row--limits">
                ${field('Раундов', 'execution.max_iterations', 'min="1" max="8"', 'number')}
                ${field('Вызовов tools', 'execution.max_tool_calls', 'min="0" max="24"', 'number')}
                ${field('Таймаут, с', 'execution.timeout_seconds', 'min="10" max="600"', 'number')}
                ${field('Повторов', 'execution.retries', 'min="0" max="3"', 'number')}
                ${field('Бюджет, $', 'budget.max_cost_usd', 'step="0.01" min="0"', 'number')}
            </div>
        </div>`;
}

function acCheckHtml() {
    const check = acState.check;
    const head = `<div class="ac-card__head"><h3><i data-lucide="shield-check" class="w-4 h-4"></i> Проверка валидатором</h3>
        ${acState.checking ? '<span class="pe-badge pe-badge--live">проверяю</span>' : check
            ? `<span class="pe-pill ${check.valid ? 'pe-pill--passed' : 'pe-pill--failed'}">${check.valid ? 'Можно запускать' : `Ошибок: ${check.errors.length}`}</span>` : ''}</div>`;
    if (!check) return `${head}<div class="pe-muted">Проверка идёт после каждого изменения.</div>`;
    const list = (items, cls, icon) => items.map(item => `<div class="ac-issue ${cls}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${peEscape(item)}</div>`).join('');
    return `${head}
        ${list(check.errors, 'ac-issue--error', 'circle-x')}
        ${list(check.warnings || [], 'ac-issue--warning', 'triangle-alert')}
        ${list(check.adjustments || [], 'ac-issue--cap', 'scissors')}
        ${check.valid && !(check.warnings || []).length && !(check.adjustments || []).length ? '<div class="pe-muted">Ошибок, предупреждений и урезаний нет.</div>' : ''}`;
}

function acRunPanelHtml() {
    const valid = acState.check && acState.check.valid;
    const run = acState.run;
    const running = run && run.state === 'running';
    const real = !acState.demo;
    return `
        <div class="ac-card__head">
            <h3><i data-lucide="play" class="w-4 h-4"></i> Запуск</h3>
            <div class="ac-actions">
                <label class="ac-toggle" title="Demo: tools возвращают демо-данные. Реальные: настоящие дом, календарь, интернет; изменения всё равно только предлагаются.">
                    <input type="checkbox" data-ac-action="toggle-demo" ${real ? 'checked' : ''}> Реальные данные</label>
                ${running
                    ? '<button class="pe-btn pe-btn--danger" data-ac-action="cancel"><i data-lucide="square" class="w-4 h-4"></i>Остановить</button>'
                    : `<button class="pe-btn" data-ac-action="run" ${valid ? '' : 'disabled title="Сначала исправьте ошибки"'}><i data-lucide="play" class="w-4 h-4"></i>Запустить</button>`}
            </div>
        </div>
        ${acState.spec.dynamism === 'static' ? '<div class="pe-muted">Статическая система запускает свою фиксированную задачу.</div>' : ''}
        ${run ? acRunHtml(run) : '<div class="pe-muted">Результат, шаги и стоимость появятся здесь.</div>'}`;
}

function acRunHtml(run) {
    const result = run.result || {};
    const seconds = run.finished_at ? run.finished_at - run.created_at : Date.now() / 1000 - run.created_at;
    const findings = result.findings || [];
    return `
        <div class="ac-run">
            <div class="ac-run__meta">
                <span class="pe-pill pe-pill--${run.state === 'waiting_for_approval' ? 'flaky' : run.state}">${AC_STATE_LABELS[run.state] || run.state}</span>
                <span>$${run.cost_usd.toFixed(4)}</span><span>${seconds.toFixed(0)} с</span>
                <span>${run.demo_mode ? 'demo' : 'реальные данные'}</span>
                ${run.stop_reason ? `<span class="pe-muted">${peEscape(run.stop_reason)}${run.detail ? `: ${peEscape(run.detail)}` : ''}</span>` : ''}
            </div>
            <div class="ac-steps">${run.steps.map(step => `
                <div class="ac-step ${acState.openStep === step.run_id ? 'ac-step--open' : ''}">
                    <button class="ac-step__head" data-ac-step="${step.run_id}">
                        <span class="pe-pill pe-pill--${step.state === 'waiting_for_approval' ? 'flaky' : step.state}">${AC_STATE_LABELS[step.state] || step.state}</span>
                        <b>${peEscape(step.node_id)}</b><span class="pe-muted">${AC_PHASE_LABELS[step.phase] || step.phase.replace('round_', 'раунд ')}</span>
                        <span class="ac-step__summary">${peEscape(step.summary)}</span>
                        <span class="pe-muted pe-nowrap">$${step.cost_usd.toFixed(4)}${step.seconds ? ` · ${step.seconds.toFixed(0)} с` : ''}</span>
                    </button>
                    ${acState.openStep === step.run_id ? acAgentRunHtml(acState.agentRuns[step.run_id]) : ''}
                </div>`).join('')}
                ${run.state === 'running' ? '<div class="ac-step ac-step--pending"><i data-lucide="loader-2" class="w-4 h-4 ac-spin"></i> Агенты работают…</div>' : ''}
            </div>
            ${result.summary ? `
                <div class="ac-result">
                    <h4>Итог</h4>
                    <p>${peEscape(result.summary)}</p>
                    ${result.answer ? `<p><b>Ответ:</b> ${peEscape(result.answer)}</p>` : ''}
                    ${findings.length ? `<ul>${findings.map(f => `<li>${peEscape(f)}</li>`).join('')}</ul>` : ''}
                    ${(result.criteria || []).length ? `<div class="ac-criteria">${result.criteria.map(c => `
                        <span class="pe-chip ${c.met ? 'ac-met' : 'ac-unmet'}" title="${peEscape(c.evidence)}">${c.met ? '✓' : '✗'} ${peEscape(c.criterion)}</span>`).join('')}</div>` : ''}
                </div>` : ''}
            ${run.proposed_actions.length ? `
                <div class="ac-result ac-result--actions">
                    <h4><i data-lucide="hand" class="w-4 h-4"></i> Предложенные действия — не выполнены</h4>
                    ${run.proposed_actions.map(a => `<div class="ac-action"><b>${peEscape(a.node)}</b> → <code>${peEscape(a.tool_name)}</code>
                        ${peEscape((a.arguments || []).map(p => `${p.name}=${p.value}`).join(', '))}<div class="pe-muted">${peEscape(a.reason)}</div></div>`).join('')}
                </div>` : ''}
        </div>`;
}

function acAgentRunHtml(agentRun) {
    if (!agentRun) return '<div class="ac-step__body pe-muted">Загрузка…</div>';
    const result = agentRun.result || {};
    return `
        <div class="ac-step__body">
            <div class="ac-run__meta">
                <span>${peEscape(agentRun.model || '—')}${agentRun.effort ? ` · ${peEscape(agentRun.effort)}` : ''}</span>
                <span>LLM: ${agentRun.llm_calls}</span><span>tools: ${agentRun.tool_calls}</span>
                ${agentRun.tools_used.length ? `<span>${peEscape(agentRun.tools_used.join(', '))}</span>` : ''}
                ${agentRun.escalations.length ? `<span class="pe-badge pe-badge--warn">эскалация ×${agentRun.escalations.length}</span>` : ''}
            </div>
            ${(result.findings || []).length ? `<ul>${result.findings.map(f => `<li>${peEscape(f)}</li>`).join('')}</ul>` : ''}
            ${(result.assignments || []).length ? `<ul>${result.assignments.map(a => `<li><b>${peEscape(a.worker)}</b>: ${peEscape(a.task)}</li>`).join('')}</ul>` : ''}
            <div class="ac-events">${agentRun.events.map(e => `
                <span class="ac-event" title="${peEscape(JSON.stringify(e.detail))}">${peEscape(e.kind)}${e.detail.tool ? `: ${peEscape(e.detail.tool)}` : ''}</span>`).join('')}
            </div>
            <div class="pe-muted">run ${peEscape(agentRun.run_id)}${agentRun.trace_id ? ` · trace ${peEscape(agentRun.trace_id)}` : ''}</div>
        </div>`;
}

function acJsonHtml() {
    return `
        <section class="ac-card">
            <div class="ac-card__head">
                <h3><i data-lucide="braces" class="w-4 h-4"></i> AgentSystemSpec</h3>
                <div class="ac-actions">
                    <button class="pe-btn pe-btn--small" data-ac-action="toggle-json">${acState.showJson ? 'Скрыть' : 'Показать JSON'}</button>
                    ${acState.showJson ? '<button class="pe-btn pe-btn--small" data-ac-action="apply-json">Применить</button>' : ''}
                </div>
            </div>
            ${acState.showJson ? `<textarea class="pe-input pe-textarea ac-json" rows="18" id="ac-json">${peEscape(JSON.stringify(acState.spec, null, 2))}</textarea>` : ''}
        </section>`;
}

function acLibraryHtml() {
    if (!acState.systems.length) {
        return '<div class="pe-empty">В библиотеке пока нет систем. Соберите систему в конструкторе и сохраните её.</div>';
    }
    return `<div class="ac-list">${acState.systems.map(system => {
        const spec = system.spec || {};
        return `
            <div class="ac-item">
                <button class="ac-item__main" data-ac-open="${system.id}">
                    <i data-lucide="${AC_TOPOLOGY_ICONS[spec.topology] || 'blocks'}" class="w-5 h-5"></i>
                    <span><b>${peEscape(system.title)}</b>
                        <span class="pe-muted">${peEscape(spec.topology || '?')} · ${peEscape(spec.activation || '')} · ${(spec.nodes || []).length} узл. · ред. ${system.revision} · ${peFormatDate(system.updated_at)}</span>
                        ${system.task ? `<span class="ac-item__task">${peEscape(system.task)}</span>` : ''}
                    </span>
                </button>
                <div class="ac-actions">
                    ${spec.activation === 'scheduled' ? `
                        <button class="pe-btn pe-btn--small" data-ac-schedule="${system.id}" title="${system.schedule_job_id ? 'Снять с расписания' : 'Поставить на расписание (сохранённая версия)'}">
                            <i data-lucide="${system.schedule_job_id ? 'calendar-x' : 'calendar-clock'}" class="w-3.5 h-3.5"></i>${system.schedule_job_id ? 'Снять' : 'По расписанию'}
                        </button>` : ''}
                    ${system.schedule_job_id ? `<span class="pe-badge pe-badge--live" title="cron ${peEscape((spec.schedule || {}).cron || '')}">${peEscape((spec.schedule || {}).cron || 'cron')}</span>` : ''}
                    <button class="pe-icon-btn" data-ac-delete="${system.id}" title="Удалить"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function acRunsHtml() {
    if (!acState.runs.length) return '<div class="pe-empty">Запусков систем за 7 дней нет.</div>';
    return `
        <table class="ac-table">
            <thead><tr><th>Когда</th><th>Система</th><th>Топология</th><th>Запуск</th><th>Статус</th><th>Шагов</th><th>$</th><th>Время</th></tr></thead>
            <tbody>${acState.runs.map(r => `
                <tr data-ac-run="${r.system_run_id}">
                    <td class="pe-nowrap">${peFormatDate(new Date(r.created_at * 1000).toISOString())}</td>
                    <td><b>${peEscape(r.name)}</b><div class="pe-muted">${peEscape(r.task)}</div></td>
                    <td>${peEscape(r.topology || '')}</td>
                    <td>${r.trigger === 'schedule' ? 'расписание' : 'вручную'}${r.demo_mode ? ' · demo' : ''}</td>
                    <td><span class="pe-pill pe-pill--${r.state === 'waiting_for_approval' ? 'flaky' : r.state}">${AC_STATE_LABELS[r.state] || r.state}</span></td>
                    <td>${r.steps}</td><td>${r.cost_usd.toFixed(4)}</td><td>${r.seconds ? `${r.seconds.toFixed(0)} с` : '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

function acTheoryHtml() {
    const catalog = acState.catalog;
    const option = o => `<li class="${o.available ? '' : 'ac-off'}"><b>${peEscape(o.label)}</b> — ${peEscape(o.description)}${o.available ? '' : `<div class="pe-muted"><i data-lucide="lock" class="w-3 h-3"></i> ${peEscape(o.reason)}</div>`}</li>`;
    return `
        <div class="ac-theory">
            <p>Конструктор следует исследованию <code>solaris-agent-architecture-research-okf</code>: 14 популярных «паттернов» описывают разные уровни системы. Поэтому система задаётся пятью независимыми измерениями, а поведенческие паттерны (ReAct, planner-executor, reflection, HITL) — это способ выполнения шага, а не топология.</p>
            <div class="ac-theory__grid">
                ${catalog.dimensions.map(d => `
                    <section class="ac-card"><h3>${peEscape(d.label)}</h3><p class="pe-muted">${peEscape(d.question)}</p><ul>${d.options.map(option).join('')}</ul></section>`).join('')}
                <section class="ac-card"><h3>Автономность</h3><p class="pe-muted">Отдельные полномочия: агент может планировать, но не иметь права менять мир.</p><ul>${catalog.autonomy.map(option).join('')}</ul></section>
                <section class="ac-card"><h3>Контроль платформы</h3><ul>
                    <li>Каждый агент проходит валидатор AgentSpec: tools только из разрешённых, бюджет и лимиты урезаются до потолков.</li>
                    <li>Write-tools никогда не исполняются агентом: только предложения на подтверждение.</li>
                    <li>Агенты передают друг другу итог и выводы, а полные данные остаются в их запусках.</li>
                    <li>Бюджет системы общий: каждый шаг получает не больше остатка. Дневной лимит всех агентов — $${catalog.limits.daily_cost_usd}.</li>
                    <li>Простая задача хуже и дороже в команде: композитор сначала предлагает одного агента.</li>
                </ul></section>
            </div>
        </div>`;
}

// --- Actions ---

function acLoadSpec(spec, { title = '', task = '', systemId = null, revision = null, demo = true, scheduleJobId = '' } = {}) {
    acState.spec = spec;
    acState.title = title;
    acState.task = task || spec.task || '';
    acState.systemId = systemId;
    acState.revision = revision;
    acState.demo = demo;
    acState.scheduleJobId = scheduleJobId;
    acState.selected = spec.nodes[0] ? spec.nodes[0].id : null;
    acState.check = null;
    acState.run = null;
    acState.openStep = null;
    acState.tab = 'build';
    acSyncPermissions(spec);
    acRender();
    acValidate();
}

async function acCompose() {
    if (!acState.task.trim()) { acSetError('Опишите задачу для композитора'); return; }
    acState.composing = true;
    acState.error = null;
    acRenderBuild();
    try {
        const result = await acPost('/compose/', { task: acState.task, topology: acState.composeTopology });
        if (!result.spec) throw new Error(result.reason || (result.errors || []).join('; ') || 'Композитор не предложил систему');
        acState.composeReason = `${result.reason} · $${result.cost_usd.toFixed(4)} · ${result.model}`;
        acState.composing = false;
        const spec = result.spec;
        spec.task = acState.task;
        acLoadSpec(spec, { title: acState.title || spec.name, task: acState.task, demo: acState.demo });
    } catch (error) {
        acState.composing = false;
        acRenderBuild();
        acSetError(error);
    }
}

async function acSave(copy = false) {
    if (!acState.title.trim()) { acSetError('Укажите название системы'); return; }
    acState.spec.task = acState.task;
    const body = { title: acState.title, spec: acState.spec, task: acState.task, demo_mode: acState.demo };
    try {
        const saved = acState.systemId && !copy
            ? await acPost(`/systems/${acState.systemId}/`, body, 'PUT')
            : await acPost('/systems/', body);
        acState.systemId = saved.id;
        acState.revision = saved.revision;
        acNotify(`Сохранено: «${saved.title}», редакция ${saved.revision}${saved.schedule_job_id ? '. Расписание использует прошлую версию: поставьте его заново в библиотеке' : ''}`);
        acRenderBuild();
    } catch (error) {
        acSetError(error);
    }
}

async function acStartRun() {
    acState.spec.task = acState.spec.task || acState.task;
    try {
        const started = await acPost('/runs/', { spec: acState.spec, task: acState.task, demo_mode: acState.demo });
        acState.openStep = null;
        acState.agentRuns = {};
        await acPollRun(started.system_run_id);
    } catch (error) {
        acSetError(error);
    }
}

async function acPollRun(runId, failures = 0) {
    clearTimeout(acState.pollTimer);
    try {
        acState.run = await acFetch(`/runs/${runId}/`);
    } catch (error) {
        // A network hiccup must not stop the progress: retry, then give up
        acSetError(error);
        if (failures < AC_POLL_RETRIES && acState.active) {
            acState.pollTimer = setTimeout(() => acPollRun(runId, failures + 1), AC_POLL_MS * 2);
        }
        return;
    }
    if (failures) acSetError(null);
    acRenderPart('ac-run-panel', acRunPanelHtml);
    acRenderPart('ac-diagram', acDiagramHtml);
    if (acState.run.state === 'running' && acState.active) {
        acState.pollTimer = setTimeout(() => acPollRun(runId), AC_POLL_MS);
    }
}

async function acOpenStep(runId) {
    acState.openStep = acState.openStep === runId ? null : runId;
    acRenderPart('ac-run-panel', acRunPanelHtml);
    if (!acState.openStep || acState.agentRuns[runId]) return;
    try {
        acState.agentRuns[runId] = await acFetch(`/agent-runs/${runId}/`);
    } catch (error) {
        acSetError(error);
    }
    acRenderPart('ac-run-panel', acRunPanelHtml);
}

async function acLoadLibrary() {
    acState.systems = (await acFetch('/systems/')).systems;
}

async function acLoadRuns() {
    acState.runs = await acFetch('/runs/?limit=50');
}

async function acOpenRun(runId) {
    const run = await acFetch(`/runs/${runId}/`);
    acLoadSpec(run.spec, { title: run.name, task: run.task, demo: run.demo_mode });
    acState.run = run;
    acRenderBuild();
    if (run.state === 'running') acPollRun(runId);
}

async function acToggleSchedule(systemId) {
    const system = acState.systems.find(s => s.id === systemId);
    try {
        const result = await acFetch(`/systems/${systemId}/schedule/`, { method: system.schedule_job_id ? 'DELETE' : 'POST', body: '{}' });
        acNotify(result.schedule ? `Расписание создано, следующий запуск: ${peFormatDate(result.schedule.next_run_at)}` : 'Расписание снято');
        await acLoadLibrary();
        acRenderBody();
    } catch (error) {
        acSetError(error);
    }
}

function acRenameNode(node, value) {
    const id = acSlug(value, node.id);
    if (id === node.id || acState.spec.nodes.some(n => n.id === id)) return;
    acState.spec.nodes.forEach(n => { n.depends_on = n.depends_on.map(d => (d === node.id ? id : d)); });
    if (acState.selected === node.id) acState.selected = id;
    node.id = id;
}

function acClick(event) {
    const target = event.target.closest('button, input[type="checkbox"], tr[data-ac-run]');
    if (!target || !acState.catalog) return;
    const data = target.dataset;
    const spec = acState.spec;
    if (data.acTab) {
        acState.tab = data.acTab;
        acRender();
        const loader = acState.tab === 'library' ? acLoadLibrary : acState.tab === 'runs' ? acLoadRuns : null;
        if (loader) loader().then(acRenderBody).catch(acSetError);
        return;
    }
    if (data.acRun) { acOpenRun(data.acRun).catch(acSetError); return; }
    if (data.acStep) { acOpenStep(data.acStep); return; }
    if (data.acOpen) {
        const system = acState.systems.find(s => s.id === Number(data.acOpen));
        acLoadSpec(structuredClone(system.spec), {
            title: system.title, task: system.task, systemId: system.id, revision: system.revision,
            demo: system.demo_mode, scheduleJobId: system.schedule_job_id,
        });
        return;
    }
    if (data.acDelete) {
        const id = Number(data.acDelete);
        acFetch(`/systems/${id}/`, { method: 'DELETE' })
            .then(() => { if (acState.systemId === id) acState.systemId = null; return acLoadLibrary(); })
            .then(acRenderBody).catch(acSetError);
        return;
    }
    if (data.acSchedule) { acToggleSchedule(Number(data.acSchedule)); return; }
    if (data.acDim) {
        const [name, value] = data.acDim.split(':');
        if (name === 'topology') acApplyTopology(spec, value);
        else spec[name] = value;
        if (name === 'dynamism' && value !== 'dynamic') {
            spec.nodes.forEach(n => { if (!n.spec) n.spec = acNewAgent(n.id); });
        }
        if (!spec.nodes.some(n => n.id === acState.selected)) acState.selected = spec.nodes[0].id;
        acSpecChanged({ structure: true });
        return;
    }
    if (data.acPower) {
        const autonomy = spec.autonomy;
        if (data.acPower === 'plan') autonomy.plan = !autonomy.plan;
        if (data.acPower === 'propose') autonomy.external_actions = autonomy.external_actions === 'propose' ? 'none' : 'propose';
        acSpecChanged({ structure: true });
        return;
    }
    if (data.acProtocol) { spec.coordination.protocol = data.acProtocol; acSpecChanged({ structure: true }); return; }
    if (data.acSelect) {
        acState.selected = data.acSelect;
        acRenderPart('ac-diagram', acDiagramHtml);
        acRenderPart('ac-editor', acEditorHtml);
        return;
    }
    if (data.acAdd) {
        let index = spec.nodes.length + 1;
        while (spec.nodes.some(n => n.id === `${data.acAdd}${index}`)) index += 1;
        const node = acNewNode(`${data.acAdd}${index}`, data.acAdd);
        if (spec.dynamism === 'dynamic') node.spec = null;
        if (data.acAdd === 'aggregator') spec.nodes.push(node);
        else {
            const tail = spec.nodes.findIndex(n => n.role === 'aggregator');
            spec.nodes.splice(tail < 0 ? spec.nodes.length : tail, 0, node);
        }
        if (spec.topology === 'workflow') node.depends_on = [spec.nodes[spec.nodes.length - 2].id];
        acState.selected = node.id;
        acSpecChanged({ structure: true });
        return;
    }
    const node = acSelectedNode();
    if (data.acDep && node) {
        node.depends_on = node.depends_on.includes(data.acDep)
            ? node.depends_on.filter(d => d !== data.acDep) : [...node.depends_on, data.acDep];
        acSpecChanged({ structure: true });
        return;
    }
    if (data.acTool && node && node.spec) {
        const tools = node.spec.tools;
        node.spec.tools = tools.includes(data.acTool) ? tools.filter(t => t !== data.acTool) : [...tools, data.acTool];
        acSpecChanged({ structure: true });
        return;
    }
    if (data.acSkill && node && node.spec) {
        const skills = node.spec.skills;
        node.spec.skills = skills.includes(data.acSkill) ? skills.filter(s => s !== data.acSkill) : [...skills, data.acSkill];
        acSpecChanged({ structure: true });
        return;
    }
    if (data.acAgentSet && node && node.spec) {
        const [path, value] = data.acAgentSet.split(':');
        acPathSet(node.spec, path, value);
        acSpecChanged({ structure: true });
        return;
    }
    switch (data.acAction) {
        case 'new': acState.composeReason = ''; acLoadSpec(acNewSystem(), { demo: acState.demo }); break;
        case 'compose': acCompose(); break;
        case 'save': acSave(false); break;
        case 'save-copy': acSave(true); break;
        case 'run': acStartRun(); break;
        case 'cancel': acFetch(`/runs/${acState.run.system_run_id}/cancel/`, { method: 'POST' }).catch(acSetError); break;
        case 'toggle-demo': acState.demo = !target.checked; break;
        case 'toggle-json': acState.showJson = !acState.showJson; acRenderBuild(); break;
        case 'apply-json':
            try {
                const parsed = JSON.parse(document.getElementById('ac-json').value);
                acLoadSpec(parsed, { title: acState.title, task: acState.task, systemId: acState.systemId, revision: acState.revision, demo: acState.demo });
            } catch (error) { acSetError(`JSON: ${error.message}`); }
            break;
        case 'toggle-dynamic':
            if (node) { node.spec = target.checked ? null : acNewAgent(node.id); acSpecChanged({ structure: true }); }
            break;
        case 'remove-node':
            if (node) {
                spec.nodes = spec.nodes.filter(n => n.id !== node.id);
                spec.nodes.forEach(n => { n.depends_on = n.depends_on.filter(d => d !== node.id); });
                acState.selected = spec.nodes[0].id;
                acSpecChanged({ structure: true });
            }
            break;
        default:
    }
}

function acValue(element) {
    if (element.dataset.acType === 'number') return element.value === '' ? 0 : Number(element.value);
    if (element.dataset.acType === 'lines') return element.value.split('\n').map(s => s.trim()).filter(Boolean);
    return element.value;
}

// Text fields change the spec without re-rendering their own form (keeps focus)
function acInput(event) {
    const element = event.target;
    const data = element.dataset;
    if (data.acField) { acState[data.acField] = element.value; return; }
    if (!acState.spec) return;
    if (data.acSpec) acPathSet(acState.spec, data.acSpec, acValue(element));
    else if (data.acNode !== undefined) {
        const node = acSelectedNode();
        if (node) node[data.acNode] = acValue(element);
    } else if (data.acAgent) {
        const node = acSelectedNode();
        if (node && node.spec) acPathSet(node.spec, data.acAgent, acValue(element));
    } else return;
    acSpecChanged({ structure: Boolean(data.acStructure) });
}

function acChange(event) {
    const element = event.target;
    if (element.dataset.acNodeId !== undefined) {
        const node = acSelectedNode();
        if (node) acRenameNode(node, element.value);
        acSpecChanged();
        acRenderPart('ac-diagram', acDiagramHtml);
        acRenderPart('ac-editor', acEditorHtml);
        return;
    }
    if (element.dataset.acAgent === 'identity.name' || element.dataset.acNode === 'step') {
        acRenderPart('ac-diagram', acDiagramHtml);
    }
}

async function initAgentConstructor() {
    const root = document.getElementById('constructor-root');
    if (!root) return;
    root.addEventListener('click', acClick);
    root.addEventListener('input', acInput);
    root.addEventListener('change', acChange);
}

async function acEnsureCatalog() {
    if (acState.catalog) return;
    acState.catalog = await acFetch('/catalog/');
    if (!acState.spec) acLoadSpec(acNewSystem());
}

function showConstructorView() {
    ['chat-view', 'dashboard-view', 'widget-view', 'voice-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    document.getElementById('constructor-view').classList.remove('hidden');
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    if (typeof stopDashboardPolling === 'function') stopDashboardPolling();
    document.getElementById('left-sidebar').classList.add('hidden');
    updateSidebarActiveState('constructor');
    acState.active = true;
    acRender();
    acEnsureCatalog().then(() => {
        acRenderBody();
        if (acState.run && acState.run.state === 'running') acPollRun(acState.run.system_run_id);
    }).catch(acSetError);
}

function hideConstructorView() {
    const view = document.getElementById('constructor-view');
    if (view) view.classList.add('hidden');
    acState.active = false;
    clearTimeout(acState.pollTimer);
}

window.showConstructorView = showConstructorView;
window.hideConstructorView = hideConstructorView;

document.addEventListener('DOMContentLoaded', initAgentConstructor);
