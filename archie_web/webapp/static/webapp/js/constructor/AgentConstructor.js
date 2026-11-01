// Agent constructor (ARCHIE-343): build an agent system along the five
// dimensions of the Solaris research, edit every agent, see the validator,
// run it (demo or real tools) and save it to the library.
// Data: Django /agent-constructor/api/ (proxy to the agent /agent-systems).
// The agent decides what is valid and what can run: the catalog marks every
// unavailable option with its reason, the validator returns every error.
//
// Layout ("schematic workbench"): a sticky toolbar (title, check, run), the
// task bar with the composer, then three zones — the dimension console, the
// schematic canvas with the run log under it, the inspector of one node.
// Text fields never re-render their own zone, so typing keeps the focus.
// Shared helpers from PromptEvals.js: peEscape, peFormatDate.

const AC_API = '/agent-constructor/api';
const AC_POLL_MS = 1500;
const AC_POLL_RETRIES = 10;
const AC_VALIDATE_DELAY_MS = 450;
const AC_TABS = [
    ['build', 'drafting-compass', 'Верстак'],
    ['library', 'library', 'Библиотека'],
    ['runs', 'history', 'Запуски'],
    ['theory', 'book-open', 'Теория'],
];
const AC_INSPECTOR_TABS = [
    ['role', 'id-card', 'Роль'],
    ['model', 'cpu', 'Модель'],
    ['tools', 'wrench', 'Tools'],
    ['limits', 'gauge', 'Лимиты'],
];
const AC_ROLE_LABELS = {
    agent: 'Агент', supervisor: 'Supervisor', worker: 'Worker', peer: 'Peer', aggregator: 'Агрегатор',
};
const AC_ROLE_ICONS = {
    agent: 'bot', supervisor: 'crown', worker: 'hammer', peer: 'users', aggregator: 'scale',
};
const AC_PROTOCOL_LABELS = { independent: 'Независимо', debate: 'Дебаты', vote: 'Голосование' };
const AC_PROTOCOL_HINTS = {
    independent: 'Peers решают независимо, агрегатор сводит результаты.',
    debate: 'Peers видят выводы друг друга и исправляют свои.',
    vote: 'Каждый peer — один голос; агрегатор выбирает ответ большинства.',
};
const AC_STATE_LABELS = {
    running: 'Идёт', completed: 'Готово', failed: 'Ошибка', cancelled: 'Отменён',
    waiting_for_approval: 'Ждёт подтверждения', created: 'Создан', configured: 'Собран',
};
const AC_PHASE_LABELS = {
    run: 'запуск', step: 'шаг', plan: 'план', work: 'работа', synthesis: 'синтез', aggregate: 'агрегация',
};
const AC_EVENT_LABELS = {
    task_created: 'задача', agent_configured: 'собран', agent_started: 'старт', tool_invoked: 'tool',
    approval_requested: 'подтверждение', agent_completed: 'готово', agent_failed: 'ошибка',
    agent_cancelled: 'отмена', budget_exhausted: 'бюджет', model_escalated: 'эскалация',
    policy_violation: 'политика', loop_guard: 'стоп-цикл',
};
// Research map: X = decentralization of decisions, Y = operational autonomy
const AC_DECENTRALIZATION = { centralized: 0.12, workflow: 0.35, hierarchical: 0.58, decentralized: 0.88 };
const AC_TOPOLOGY_ICONS = {
    centralized: 'circle-dot', workflow: 'workflow', hierarchical: 'network', decentralized: 'share-2',
};
// Smallest node budget that fits one run of the profile (ARCHIE-345 probe: Luna
// $0.0004, Terra $0.003, Sonnet $0.017, Opus $0.044 per short task; the
// platform reserves the worst case before every call)
const AC_PROFILE_BUDGET = { FAST: 0.02, BALANCED: 0.05, DEEP: 0.15, MAXIMUM: 0.3 };
const AC_NODE_W = 184;
const AC_NODE_H = 84;

// Starting points: a task and a team that fits each topology
const AC_TEMPLATES = [
    {
        topology: 'centralized',
        title: 'Один исследователь',
        hint: 'Один агент сам выбирает шаги. Дешевле и надёжнее для большинства задач.',
        task: 'Найди три веганских кафе рядом с домом и сравни их по рейтингу и часам работы.',
        nodes: [['researcher', 'agent', 'Исследователь', 'Найти и сравнить варианты', '', ['google_places_search_tool', 'google_search_tool']]],
    },
    {
        topology: 'workflow',
        title: 'Сбор → анализ → отчёт',
        hint: 'Шаги и зависимости заданы. Независимые шаги идут параллельно.',
        task: 'Что лучше сделать завтра на выходных в городе?',
        nodes: [
            ['weather', 'agent', 'Синоптик', 'Узнать прогноз', 'Найди прогноз погоды на завтра.', ['google_search_tool']],
            ['events', 'agent', 'Афиша', 'Найти события', 'Найди события в городе на завтра.', ['google_search_tool']],
            ['planner', 'agent', 'Планировщик', 'Составить план', 'Предложи план дня по прогнозу и событиям.', []],
        ],
        links: { planner: ['weather', 'events'] },
    },
    {
        topology: 'hierarchical',
        title: 'Руководитель и команда',
        hint: 'Supervisor раздаёт подзадачи workers и собирает итог.',
        task: 'Сравни Raspberry Pi 5 и Orange Pi 5 для домашнего сервера: цена, отзывы, энергопотребление.',
        nodes: [
            ['lead', 'supervisor', 'Руководитель исследования', 'Разбить задачу и собрать итог', '', []],
            ['prices', 'worker', 'Аналитик цен', 'Найти цены', 'Цены и доступность.', ['google_search_tool']],
            ['reviews', 'worker', 'Аналитик отзывов', 'Найти отзывы', 'Отзывы и тесты.', ['google_search_tool']],
        ],
    },
    {
        topology: 'decentralized',
        title: 'Дебаты и судья',
        hint: 'Равные агенты спорят, агрегатор сводит мнения и расхождения.',
        task: 'Стоит ли ставить умный термостат в съёмной квартире?',
        protocol: 'debate',
        nodes: [
            ['optimist', 'peer', 'Оптимист', 'Аргументы за', 'Ищи выгоды и аргументы за.', ['google_search_tool']],
            ['skeptic', 'peer', 'Скептик', 'Аргументы против', 'Ищи риски и аргументы против.', ['google_search_tool']],
            ['judge', 'aggregator', 'Судья', 'Свести мнения', '', []],
        ],
    },
];

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
    inspectorTab: 'role',
    pristine: true,
    dirty: false,
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
    tickTimer: null,
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
    setTimeout(() => { if (acState.notice === text) { acState.notice = null; acRenderMessages(); } }, 4500);
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
    return Boolean(tool && tool.effect === 'write');
}

function acSlug(text, fallback) {
    const slug = String(text || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 32);
    return slug || fallback;
}

function acNewAgent(name, role = 'Исследователь', purpose = 'Найти и проверить факты по задаче', tools = ['google_search_tool']) {
    return {
        identity: { name, role, purpose },
        objective: { task: 'Задача системы', completion_criteria: ['Результат подтверждён данными tools'] },
        instructions: '',
        model: { profile: 'BALANCED', effort: 'medium', reason: '' },
        tools,
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

function acBaseSystem() {
    return {
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
}

function acFromTemplate(template) {
    const spec = acBaseSystem();
    spec.name = acSlug(template.topology, 'system');
    spec.topology = template.topology;
    spec.coordination.protocol = template.protocol || 'independent';
    spec.nodes = template.nodes.map(([id, role, title, purpose, step, tools]) => {
        const agent = acNewAgent(id, title, purpose, tools);
        if (role === 'supervisor' || role === 'aggregator') agent.output.schema_name = 'answer_v1';
        return { id, role, step, depends_on: (template.links || {})[id] || [], spec: agent };
    });
    return spec;
}

// Keep the nodes, give them roles and links that fit the new topology
function acApplyTopology(spec, topology) {
    spec.topology = topology;
    let nodes = spec.nodes;
    const fresh = (prefix, role) => {
        let index = 1;
        while (nodes.some(n => n.id === `${prefix}${index}`)) index += 1;
        const node = acNewNode(`${prefix}${index}`, role);
        if (spec.dynamism === 'dynamic') node.spec = null;
        return node;
    };
    if (topology === 'centralized') {
        nodes = [nodes.find(n => n.role !== 'aggregator') || nodes[0]];
        nodes[0].role = 'agent';
        nodes[0].depends_on = [];
    } else if (topology === 'workflow') {
        if (nodes.length < 2) nodes.push(fresh('step', 'agent'));
        nodes.forEach((n, i) => { n.role = 'agent'; n.depends_on = i ? [nodes[i - 1].id] : []; });
    } else if (topology === 'hierarchical') {
        nodes = nodes.filter(n => n.role !== 'aggregator');
        if (nodes.length < 2) nodes.push(fresh('worker', 'worker'));
        nodes.forEach((n, i) => { n.role = i ? 'worker' : 'supervisor'; n.depends_on = []; });
        nodes = nodes.slice(0, 1 + acState.catalog.limits.max_workers);
    } else {
        nodes = nodes.filter(n => n.role !== 'aggregator');
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

// Validator errors name their node ("node lead: ..."); the canvas marks it
function acNodeIssues(nodeId) {
    const check = acState.check;
    if (!check) return [];
    return check.errors.filter(e => e.startsWith(`node ${nodeId}:`) || e.startsWith(`node ${nodeId} `))
        .map(e => e.replace(/^node [a-z0-9_]+:?\s*/, ''));
}

function acSystemIssues() {
    const check = acState.check;
    if (!check) return [];
    return check.errors.filter(e => !/^node [a-z0-9_]+[: ]/.test(e));
}

function acMarkDirty() {
    acState.pristine = false;
    if (!acState.dirty) {
        acState.dirty = true;
        acRenderPart('ac-save', acSaveHtml);
    }
}

function acSpecChanged({ structure = false } = {}) {
    acSyncPermissions(acState.spec);
    acMarkDirty();
    clearTimeout(acState.validateTimer);
    acState.validateTimer = setTimeout(acValidate, AC_VALIDATE_DELAY_MS);
    if (structure) acRenderWorkbench();
}

async function acValidate() {
    if (!acState.spec) return;
    acState.checking = true;
    acRenderPart('ac-status', acStatusHtml);
    try {
        acState.check = await acPost('/validate/', { spec: acState.spec });
    } catch (error) {
        acState.check = { valid: false, errors: [String(error.message || error)], warnings: [], adjustments: [] };
    }
    acState.checking = false;
    acRenderPart('ac-status', acStatusHtml);
    acRenderPart('ac-runbar', acRunBarHtml);
    acRenderPart('ac-issues', acIssuesHtml);
    acRenderPart('ac-canvas', acCanvasHtml);
    acRenderPart('ac-inspector-issues', acInspectorIssuesHtml);
}

// --- Rendering helpers ---

function acRenderPart(id, render) {
    const element = document.getElementById(id);
    if (!element) return;
    element.innerHTML = render();
    lucide.createIcons({ nodes: [element] });
}

function acIcon(name, size = 4) {
    return `<i data-lucide="${name}" class="w-${size} h-${size}"></i>`;
}

function acRenderMessages() {
    acRenderPart('ac-messages', () => [
        acState.error ? `<div class="ac-toast ac-toast--error">${acIcon('octagon-alert')}<span>${peEscape(acState.error)}</span><button class="ac-toast__close" data-ac-action="dismiss">${acIcon('x', 3.5)}</button></div>` : '',
        acState.notice ? `<div class="ac-toast">${acIcon('check-circle-2')}<span>${peEscape(acState.notice)}</span></div>` : '',
    ].join(''));
}

function acRender() {
    const root = document.getElementById('constructor-root');
    if (!root) return;
    root.innerHTML = `
        <header class="ac-head">
            <div class="ac-brand">
                <span class="ac-brand__mark">${acIcon('drafting-compass', 5)}</span>
                <div><div class="ac-brand__title">Конструктор агентов</div>
                <div class="ac-brand__sub">пять измерений · AgentSpec · проверка платформой</div></div>
            </div>
            <nav class="ac-tabs">
                ${AC_TABS.map(([key, icon, label]) => `
                    <button class="ac-tab ${acState.tab === key ? 'ac-tab--on' : ''}" data-ac-tab="${key}">${acIcon(icon)}${label}</button>`).join('')}
            </nav>
        </header>
        <div id="ac-messages" class="ac-messages"></div>
        <div id="ac-body" class="ac-body"></div>`;
    lucide.createIcons({ nodes: [root] });
    acRenderMessages();
    acRenderBody();
}

function acRenderBody() {
    if (!acState.catalog) {
        acRenderPart('ac-body', () => `<div class="ac-loading"><span class="ac-loading__grid"></span>Загружаю каталог платформы…</div>`);
        return;
    }
    if (acState.tab === 'library') acRenderPart('ac-body', acLibraryHtml);
    else if (acState.tab === 'runs') acRenderPart('ac-body', acRunsHtml);
    else if (acState.tab === 'theory') acRenderPart('ac-body', acTheoryHtml);
    else acRenderBuild();
}

// --- Workbench ---

function acRenderBuild() {
    if (acState.tab !== 'build') return;
    acRenderPart('ac-body', () => `
        <div class="ac-bench">
            <div class="ac-toolbar">
                <div class="ac-toolbar__name">
                    <input class="ac-title-input" data-ac-field="title" value="${peEscape(acState.title)}" placeholder="Без названия" aria-label="Название системы" maxlength="120">
                    <span class="ac-slug">${acIcon('hash', 3)}<input class="ac-slug__input" data-ac-spec="name" value="${peEscape(acState.spec.name)}" aria-label="Имя системы (slug)" spellcheck="false"></span>
                </div>
                <div id="ac-status" class="ac-toolbar__status">${acStatusHtml()}</div>
                <div class="ac-toolbar__actions">
                    <span id="ac-save">${acSaveHtml()}</span>
                    <button class="ac-icon-btn" data-ac-action="new" title="Новая система">${acIcon('file-plus-2')}</button>
                    <button class="ac-icon-btn ${acState.showJson ? 'ac-icon-btn--on' : ''}" data-ac-action="toggle-json" title="AgentSystemSpec в JSON">${acIcon('braces')}</button>
                    <span id="ac-runbar" class="ac-runbar">${acRunBarHtml()}</span>
                </div>
            </div>
            ${acTaskBarHtml()}
            <div class="ac-zones">
                <aside class="ac-console" id="ac-dims">${acDimensionsHtml()}</aside>
                <main class="ac-stage">
                    <section class="ac-canvas-wrap">
                        <div class="ac-canvas-head">
                            <span class="ac-kicker">${acIcon(AC_TOPOLOGY_ICONS[acState.spec.topology], 3.5)}схема · ${peEscape(acDimension('topology').options.find(o => o.value === acState.spec.topology).label)}</span>
                            <div class="ac-canvas-tools">${acAddNodeHtml()}</div>
                        </div>
                        <div id="ac-canvas">${acCanvasHtml()}</div>
                    </section>
                    <section id="ac-runlog" class="ac-runlog">${acRunLogHtml()}</section>
                    ${acState.showJson ? acJsonHtml() : ''}
                </main>
                <aside class="ac-inspector" id="ac-inspector">${acInspectorHtml()}</aside>
            </div>
        </div>`);
}

function acRenderWorkbench() {
    acRenderPart('ac-dims', acDimensionsHtml);
    acRenderPart('ac-canvas', acCanvasHtml);
    acRenderPart('ac-inspector', acInspectorHtml);
    const head = document.querySelector('.ac-canvas-head');
    if (head) {
        head.innerHTML = `<span class="ac-kicker">${acIcon(AC_TOPOLOGY_ICONS[acState.spec.topology], 3.5)}схема · ${peEscape(acDimension('topology').options.find(o => o.value === acState.spec.topology).label)}</span>
            <div class="ac-canvas-tools">${acAddNodeHtml()}</div>`;
        lucide.createIcons({ nodes: [head] });
    }
}

function acStatusHtml() {
    const check = acState.check;
    if (acState.checking && !check) return `<span class="ac-signal ac-signal--busy"><span class="ac-led"></span>проверяю</span>`;
    if (!check) return '';
    const warn = (check.warnings || []).length;
    const caps = (check.adjustments || []).length;
    const errors = check.errors.length;
    return `
        <button class="ac-signal ${errors ? 'ac-signal--bad' : 'ac-signal--ok'} ${acState.checking ? 'ac-signal--pulse' : ''}" data-ac-action="goto-issues" title="Вердикт валидатора платформы">
            <span class="ac-led"></span>${errors ? `${errors} ${errors === 1 ? 'ошибка' : errors < 5 ? 'ошибки' : 'ошибок'}` : 'Можно запускать'}
        </button>
        ${warn ? `<span class="ac-chip ac-chip--warn" title="Предупреждения">${acIcon('triangle-alert', 3)}${warn}</span>` : ''}
        ${caps ? `<span class="ac-chip" title="Урезано до потолков платформы">${acIcon('scissors', 3)}${caps}</span>` : ''}`;
}

function acSaveHtml() {
    const label = acState.systemId ? `ред. ${acState.revision}` : 'не сохранена';
    return `
        <button class="ac-save ${acState.dirty ? 'ac-save--dirty' : ''}" data-ac-action="save" title="Сохранить в библиотеку (Ctrl+S)">
            ${acIcon('save', 3.5)}<span>${acState.dirty ? 'Сохранить' : acState.systemId ? 'Сохранено' : 'В библиотеку'}</span><em>${label}</em>
        </button>
        ${acState.systemId ? `<button class="ac-icon-btn" data-ac-action="save-copy" title="Сохранить как новую">${acIcon('copy-plus')}</button>` : ''}`;
}

function acRunBarHtml() {
    const valid = acState.check && acState.check.valid;
    const running = acState.run && acState.run.state === 'running';
    return `
        <span class="ac-mode" role="group" aria-label="Данные tools" title="Demo: дом, календарь, заметки и задачи отдают демо-данные; веб-поиск и места всегда настоящие. Изменения в обоих режимах только предлагаются.">
            <button class="${acState.demo ? 'ac-mode--on' : ''}" data-ac-action="mode-demo">demo</button>
            <button class="${acState.demo ? '' : 'ac-mode--on ac-mode--real'}" data-ac-action="mode-real">реальные</button>
        </span>
        ${running
            ? `<button class="ac-run ac-run--stop" data-ac-action="cancel">${acIcon('square', 3.5)}Стоп</button>`
            : `<button class="ac-run" data-ac-action="run" ${valid ? '' : 'disabled'} title="${valid ? 'Запустить (Ctrl+Enter)' : 'Сначала исправьте ошибки'}">${acIcon('play', 3.5)}Запустить</button>`}`;
}

function acTaskBarHtml() {
    const topologies = acDimension('topology').options;
    const staticTask = acState.spec.dynamism === 'static' || acState.spec.activation === 'scheduled';
    return `
        <section class="ac-taskbar">
            <label class="ac-taskbar__label" for="ac-task">${acIcon('target', 3.5)}Задача${staticTask ? ' <em>фиксированная: её запускает расписание или статическая система</em>' : ''}</label>
            <div class="ac-taskbar__row">
                <textarea id="ac-task" class="ac-task" rows="2" data-ac-field="task" placeholder="Опишите, что должна сделать система — например: «Почему вырос расход электроэнергии за неделю?»">${peEscape(acState.task)}</textarea>
                <div class="ac-compose">
                    <select class="ac-select" data-ac-field="composeTopology" aria-label="Топология для композитора">
                        <option value="">топология — на выбор композитора</option>
                        ${topologies.map(o => `<option value="${o.value}" ${acState.composeTopology === o.value ? 'selected' : ''}>${peEscape(o.label)}</option>`).join('')}
                    </select>
                    <button class="ac-compose__btn" data-ac-action="compose" ${acState.composing ? 'disabled' : ''}>
                        ${acState.composing ? `<span class="ac-spinner"></span>Композитор думает…` : `${acIcon('wand-sparkles')}Предложить архитектуру`}
                    </button>
                </div>
            </div>
            ${acState.composeReason ? `<p class="ac-quote">${acIcon('quote', 3)}${peEscape(acState.composeReason)}</p>` : ''}
        </section>`;
}

// --- Dimension console ---

function acSegment(dimension, current) {
    return `<div class="ac-seg">${dimension.options.map(option => `
        <button class="ac-seg__opt ${option.value === current ? 'ac-seg__opt--on' : ''} ${option.available ? '' : 'ac-seg__opt--locked'}"
            ${option.available ? `data-ac-dim="${dimension.name}:${option.value}"` : 'aria-disabled="true"'}
            title="${peEscape(option.available ? option.description : `Недоступно: ${option.reason}`)}">
            ${option.available ? '' : acIcon('lock', 3)}<span>${peEscape(option.label)}</span>
        </button>`).join('')}</div>`;
}

function acDimensionsHtml() {
    const spec = acState.spec;
    const rows = ['topology', 'activation', 'lifecycle', 'dynamism'].map((name, index) => {
        const dimension = acDimension(name);
        const option = dimension.options.find(o => o.value === spec[name]);
        return `
            <div class="ac-dim" style="--i:${index}">
                <div class="ac-dim__head"><span class="ac-dim__num">0${index + 1}</span><b>${peEscape(dimension.label)}</b></div>
                <div class="ac-dim__q">${peEscape(dimension.question)}</div>
                ${acSegment(dimension, spec[name])}
                <div class="ac-dim__hint">${peEscape(option ? option.description : '')}</div>
                ${name === 'topology' && spec.topology === 'decentralized' ? acCoordinationHtml() : ''}
                ${name === 'activation' && spec.activation === 'scheduled' ? acScheduleHtml() : ''}
            </div>`;
    }).join('');
    return `
        <div class="ac-console__title">${acIcon('sliders-horizontal', 3.5)}Пять измерений</div>
        ${rows}
        ${acAutonomyHtml()}
        <div class="ac-dim" style="--i:5">
            <div class="ac-dim__head"><span class="ac-dim__num">$</span><b>Бюджет запуска</b></div>
            <div class="ac-dim__q">общий на всю систему · потолок $${acState.catalog.limits.system_max_cost_usd}</div>
            <div class="ac-pair">
                <label class="ac-unit"><span>$</span><input type="number" step="0.01" min="0.01" data-ac-spec="budget.max_cost_usd" data-ac-type="number" value="${spec.budget.max_cost_usd}"></label>
                <label class="ac-unit"><input type="number" step="10" min="10" data-ac-spec="budget.max_seconds" data-ac-type="number" value="${spec.budget.max_seconds}"><span>сек</span></label>
            </div>
        </div>
        ${acMapHtml()}
        <div id="ac-issues" class="ac-issues">${acIssuesHtml()}</div>`;
}

function acCoordinationHtml() {
    const coordination = acState.spec.coordination;
    return `
        <div class="ac-sub">
            <div class="ac-seg ac-seg--small">${Object.entries(AC_PROTOCOL_LABELS).map(([value, label]) => `
                <button class="ac-seg__opt ${coordination.protocol === value ? 'ac-seg__opt--on' : ''}" data-ac-protocol="${value}" title="${AC_PROTOCOL_HINTS[value]}">${label}</button>`).join('')}
            </div>
            <div class="ac-dim__hint">${AC_PROTOCOL_HINTS[coordination.protocol]}</div>
            ${coordination.protocol === 'debate' ? `
                <div class="ac-stepper">Раундов дебатов
                    ${[1, 2].map(n => `<button class="${coordination.debate_rounds === n ? 'ac-stepper--on' : ''}" data-ac-rounds="${n}">${n}</button>`).join('')}
                </div>` : ''}
        </div>`;
}

function acScheduleHtml() {
    const schedule = acState.spec.schedule || { cron: '0 8 * * *', timezone: acState.catalog.timezone };
    acState.spec.schedule = schedule;
    return `
        <div class="ac-sub">
            <div class="ac-pair">
                <label class="ac-unit ac-unit--wide"><span>cron</span><input data-ac-spec="schedule.cron" value="${peEscape(schedule.cron)}" placeholder="0 8 * * *" spellcheck="false"></label>
                <label class="ac-unit ac-unit--wide"><span>tz</span><input data-ac-spec="schedule.timezone" value="${peEscape(schedule.timezone)}" spellcheck="false"></label>
            </div>
            <div class="ac-dim__hint">Расписание ставится в библиотеке и запускает сохранённую версию.</div>
        </div>`;
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
        <div class="ac-dim" style="--i:4">
            <div class="ac-dim__head"><span class="ac-dim__num">05</span><b>Автономность</b></div>
            <div class="ac-dim__q">отдельные полномочия, а не шкала</div>
            <div class="ac-powers">${acState.catalog.autonomy.map(power => {
                const fixed = power.value === 'choose_tools';
                const locked = !power.available;
                return `<button class="ac-power ${on[power.value] ? 'ac-power--on' : ''} ${locked ? 'ac-power--locked' : ''}"
                    ${locked || fixed ? 'aria-disabled="true"' : `data-ac-power="${power.value}"`}
                    title="${peEscape(locked ? `Недоступно: ${power.reason}` : power.description)}">
                    <span class="ac-switch"><span></span></span>${peEscape(power.label)}${locked ? acIcon('lock', 3) : ''}</button>`;
            }).join('')}</div>
            <div class="ac-dim__hint">${on.propose
                ? 'Write-tools становятся предложениями на подтверждение — агенты ничего не меняют сами.'
                : 'Только чтение: tools с побочными эффектами агентам недоступны.'}</div>
        </div>`;
}

function acAutonomyScore() {
    const autonomy = acState.spec.autonomy;
    return (1 + (autonomy.plan ? 1 : 0) + (autonomy.external_actions === 'propose' ? 1 : 0)) / 6;
}

function acMapHtml() {
    const x = AC_DECENTRALIZATION[acState.spec.topology];
    const y = acAutonomyScore();
    const w = 240;
    const h = 132;
    const px = 30 + x * (w - 40);
    const py = 8 + (1 - y) * (h - 34);
    const ghosts = Object.entries(AC_DECENTRALIZATION).map(([topology, gx]) => `
        <line x1="${30 + gx * (w - 40)}" y1="8" x2="${30 + gx * (w - 40)}" y2="${h - 26}" class="ac-map__tick"/>
        <text x="${30 + gx * (w - 40)}" y="${h - 16}" class="ac-map__name" text-anchor="middle">${topology.slice(0, 4)}</text>`).join('');
    return `
        <div class="ac-dim ac-map-box" style="--i:6">
            <div class="ac-dim__head"><span class="ac-dim__num">⌖</span><b>Положение на карте</b></div>
            <svg class="ac-map" viewBox="0 0 ${w} ${h}" role="img" aria-label="Децентрализация и автономность">
                <rect x="30" y="8" width="${w - 40}" height="${h - 34}" class="ac-map__area" rx="4"/>
                ${ghosts}
                <line x1="${px}" y1="8" x2="${px}" y2="${h - 26}" class="ac-map__cross"/>
                <line x1="30" y1="${py}" x2="${w - 10}" y2="${py}" class="ac-map__cross"/>
                <circle cx="${px}" cy="${py}" r="10" class="ac-map__halo"/>
                <circle cx="${px}" cy="${py}" r="4.5" class="ac-map__dot"/>
                <text x="${30 + (w - 40) / 2}" y="${h - 2}" class="ac-map__label" text-anchor="middle">децентрализация решений →</text>
                <text x="10" y="${(h - 26) / 2 + 4}" class="ac-map__label" text-anchor="middle" transform="rotate(-90 10 ${(h - 26) / 2 + 4})">автономность →</text>
            </svg>
            <div class="ac-dim__q">для обсуждения, не калиброванная оценка</div>
        </div>`;
}

function acIssuesHtml() {
    const check = acState.check;
    if (!check) return '';
    const list = (items, kind, icon) => items.map(item => `<li class="ac-issue ac-issue--${kind}">${acIcon(icon, 3.5)}<span>${peEscape(item)}</span></li>`).join('');
    const system = acSystemIssues();
    const nodeErrors = check.errors.length - system.length;
    const any = check.errors.length || (check.warnings || []).length || (check.adjustments || []).length;
    return `
        <div class="ac-console__title">${acIcon('shield-check', 3.5)}Вердикт валидатора</div>
        ${any ? `<ul class="ac-issue-list">
            ${list(system, 'error', 'circle-x')}
            ${nodeErrors ? `<li class="ac-issue ac-issue--error">${acIcon('git-commit-vertical', 3.5)}<span>${nodeErrors} — в узлах: отмечены на схеме и в инспекторе</span></li>` : ''}
            ${list(check.warnings || [], 'warn', 'triangle-alert')}
            ${list(check.adjustments || [], 'cap', 'scissors')}
        </ul>` : `<p class="ac-dim__hint">Ошибок, предупреждений и урезаний нет.</p>`}`;
}

// --- Canvas ---

function acAddNodeHtml() {
    const spec = acState.spec;
    if (spec.topology === 'centralized') return '<span class="ac-dim__q">один агент — добавлять некого</span>';
    const roles = acState.catalog.topology_roles[spec.topology]
        .filter(role => !(role === 'supervisor' && spec.nodes.some(n => n.role === 'supervisor')))
        .filter(role => !(role === 'aggregator' && spec.nodes.some(n => n.role === 'aggregator')));
    const full = spec.nodes.length >= acState.catalog.limits.max_nodes;
    return roles.map(role => `
        <button class="ac-add" data-ac-add="${role}" ${full ? 'disabled title="Достигнут предел узлов"' : `title="Добавить: ${AC_ROLE_LABELS[role]}"`}>
            ${acIcon('plus', 3)}${AC_ROLE_LABELS[role]}</button>`).join('');
}

// Layout: groups of node ids in rows or columns; edges as [from, to, kind]
function acLayout(spec) {
    const nodes = spec.nodes;
    if (spec.topology === 'workflow') {
        const level = {};
        const depth = (node, seen = new Set()) => {
            if (level[node.id] !== undefined) return level[node.id];
            if (seen.has(node.id)) return 0;
            seen.add(node.id);
            const parents = node.depends_on.map(id => nodes.find(n => n.id === id)).filter(Boolean);
            level[node.id] = parents.length ? 1 + Math.max(...parents.map(p => depth(p, seen))) : 0;
            return level[node.id];
        };
        nodes.forEach(n => depth(n));
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
            ? peers.slice(0, -1).map((a, i) => [a, peers[i + 1], 'mesh']) : [];
        return { direction: 'rows', groups: [peers, judges], edges: [...mesh, ...peers.flatMap(p => judges.map(j => [p, j]))] };
    }
    return { direction: 'rows', groups: [[nodes[0].id]], edges: [] };
}

function acNodeStatus(nodeId) {
    const run = acState.run;
    if (!run) return '';
    const started = run.events.filter(e => e.kind === 'step_started' && e.detail.node === nodeId).length;
    const steps = run.steps.filter(s => s.node_id === nodeId);
    if (run.state === 'running' && started > steps.length) return 'running';
    return steps.length ? steps[steps.length - 1].state : '';
}

function acCanvasHtml() {
    const spec = acState.spec;
    if (acState.pristine && !acState.run) return acTemplatesHtml();
    const layout = acLayout(spec);
    const gapX = 56;
    const gapY = 64;
    const positions = {};
    const groups = layout.groups.filter(g => g.length);
    const longest = Math.max(...groups.map(g => g.length));
    const columns = layout.direction === 'columns';
    const span = columns
        ? { width: groups.length * (AC_NODE_W + gapX) - gapX, height: longest * (AC_NODE_H + 22) - 22 }
        : { width: longest * (AC_NODE_W + gapX) - gapX, height: groups.length * (AC_NODE_H + gapY) - gapY };
    groups.forEach((group, g) => group.forEach((id, i) => {
        if (columns) {
            const offset = (span.height - (group.length * (AC_NODE_H + 22) - 22)) / 2;
            positions[id] = { x: g * (AC_NODE_W + gapX), y: offset + i * (AC_NODE_H + 22) };
        } else {
            const offset = (span.width - (group.length * (AC_NODE_W + gapX) - gapX)) / 2;
            positions[id] = { x: offset + i * (AC_NODE_W + gapX), y: g * (AC_NODE_H + gapY) };
        }
    }));
    const live = new Set(spec.nodes.filter(n => acNodeStatus(n.id) === 'running').map(n => n.id));
    const edges = layout.edges.map(([from, to, kind]) => {
        const a = positions[from];
        const b = positions[to];
        if (!a || !b) return '';
        const flowing = live.has(to) || live.has(from) ? 'ac-edge--live' : '';
        if (kind === 'mesh') {
            const y = a.y + AC_NODE_H / 2;
            return `<path d="M${a.x + AC_NODE_W} ${y} L${b.x} ${y}" class="ac-edge ac-edge--mesh ${flowing}"/>`;
        }
        if (columns) {
            const [x1, y1, x2, y2] = [a.x + AC_NODE_W, a.y + AC_NODE_H / 2, b.x, b.y + AC_NODE_H / 2];
            const mid = (x1 + x2) / 2;
            return `<path d="M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2 - 4} ${y2}" class="ac-edge ${flowing}" marker-end="url(#ac-arrow)"/>`;
        }
        const [x1, y1, x2, y2] = [a.x + AC_NODE_W / 2, a.y + AC_NODE_H, b.x + AC_NODE_W / 2, b.y];
        const mid = (y1 + y2) / 2;
        return `<path d="M${x1} ${y1} C${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2 - 4}" class="ac-edge ${flowing}" marker-end="url(#ac-arrow)"/>`;
    }).join('');
    const run = acState.run;
    const boxes = spec.nodes.map((node, index) => {
        const p = positions[node.id];
        if (!p) return '';
        const status = acNodeStatus(node.id);
        const issues = acNodeIssues(node.id);
        const agentSpec = node.spec || (run && run.configured[node.id]);
        const cost = run ? run.steps.filter(s => s.node_id === node.id).reduce((sum, s) => sum + s.cost_usd, 0) : 0;
        return `
            <button class="ac-node ac-node--${node.role} ${acState.selected === node.id ? 'ac-node--selected' : ''} ${status ? `ac-node--${status}` : ''} ${issues.length ? 'ac-node--invalid' : ''}"
                style="left:${p.x}px;top:${p.y}px;width:${AC_NODE_W}px;height:${AC_NODE_H}px;--i:${index}" data-ac-select="${node.id}">
                <span class="ac-node__bar"></span>
                <span class="ac-node__top">
                    <span class="ac-node__role">${acIcon(AC_ROLE_ICONS[node.role], 3)}${AC_ROLE_LABELS[node.role]}</span>
                    ${status ? `<span class="ac-node__state">${AC_STATE_LABELS[status] || status}</span>` : ''}
                    ${issues.length ? `<span class="ac-node__bad" title="${peEscape(issues.join('\n'))}">${issues.length}</span>` : ''}
                </span>
                <span class="ac-node__id">${peEscape(node.id)}</span>
                <span class="ac-node__meta">${agentSpec
                    ? `<b>${agentSpec.model.profile}</b><span>${agentSpec.tools.length} tools</span>${cost ? `<span>$${cost.toFixed(4)}</span>` : ''}`
                    : '<i>соберёт конфигуратор</i>'}</span>
                <span class="ac-port ac-port--in"></span><span class="ac-port ac-port--out"></span>
            </button>`;
    }).join('');
    return `
        <div class="ac-canvas">
            <div class="ac-canvas__inner" style="width:${span.width}px;height:${span.height}px">
                <svg class="ac-canvas__edges" width="${span.width}" height="${span.height}" aria-hidden="true">
                    <defs><marker id="ac-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="ac-arrow"/></marker></defs>
                    ${edges}
                </svg>
                ${boxes}
            </div>
        </div>
        <div class="ac-canvas-foot">${spec.topology === 'workflow'
            ? 'Стрелка — результат передаётся дальше. Шаги в одной колонке идут параллельно.'
            : spec.topology === 'hierarchical' ? 'Supervisor планирует, workers работают параллельно, supervisor собирает итог.'
            : spec.topology === 'decentralized' ? (spec.coordination.protocol === 'debate' ? 'Пунктир — peers видят выводы друг друга перед следующим раундом.' : 'Peers не видят друг друга; итог сводит агрегатор.')
            : 'Нажмите на узел — справа откроется инспектор агента.'}</div>`;
}

function acTemplatesHtml() {
    return `
        <div class="ac-start">
            <div class="ac-start__lead">
                <h3>С чего начать?</h3>
                <p>Опишите задачу выше и попросите композитор предложить архитектуру — или возьмите шаблон и правьте его под себя.</p>
            </div>
            <div class="ac-templates">${AC_TEMPLATES.map((t, i) => `
                <button class="ac-template" data-ac-template="${i}" style="--i:${i}">
                    <span class="ac-template__glyph ac-template__glyph--${t.topology}">${acTemplateGlyph(t.topology)}</span>
                    <b>${peEscape(t.title)}</b>
                    <span>${peEscape(t.hint)}</span>
                    <em>${peEscape(t.task)}</em>
                </button>`).join('')}
            </div>
        </div>`;
}

function acTemplateGlyph(topology) {
    const dot = (x, y, cls = '') => `<circle cx="${x}" cy="${y}" r="5" class="${cls}"/>`;
    const line = (x1, y1, x2, y2, cls = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
    const shapes = {
        centralized: `${dot(40, 22)}${line(40, 22, 14, 8, 'g')}${line(40, 22, 66, 8, 'g')}${line(40, 22, 40, 40, 'g')}`,
        workflow: `${line(12, 12, 40, 22)}${line(12, 32, 40, 22)}${line(40, 22, 68, 22)}${dot(12, 12)}${dot(12, 32)}${dot(40, 22)}${dot(68, 22)}`,
        hierarchical: `${line(40, 8, 16, 36)}${line(40, 8, 40, 36)}${line(40, 8, 64, 36)}${dot(40, 8, 'k')}${dot(16, 36)}${dot(40, 36)}${dot(64, 36)}`,
        decentralized: `${line(14, 10, 40, 10, 'm')}${line(40, 10, 66, 10, 'm')}${line(14, 10, 40, 36)}${line(40, 10, 40, 36)}${line(66, 10, 40, 36)}${dot(14, 10)}${dot(40, 10)}${dot(66, 10)}${dot(40, 36, 'k')}`,
    };
    return `<svg viewBox="0 0 80 46" aria-hidden="true">${shapes[topology]}</svg>`;
}

// --- Inspector ---

function acInspectorHtml() {
    const node = acSelectedNode();
    if (!node) return `<div class="ac-inspector__empty">${acIcon('mouse-pointer-click', 6)}<p>Выберите узел на схеме.</p></div>`;
    const spec = acState.spec;
    const roles = acState.catalog.topology_roles[spec.topology];
    const dynamic = spec.dynamism === 'dynamic';
    const removable = spec.nodes.length > 1 && spec.topology !== 'centralized';
    return `
        <div class="ac-insp-head ac-insp-head--${node.role}">
            <span class="ac-insp-head__icon">${acIcon(AC_ROLE_ICONS[node.role], 5)}</span>
            <div class="ac-insp-head__text">
                <input class="ac-insp-id" data-ac-node-id value="${peEscape(node.id)}" aria-label="Id узла" spellcheck="false">
                <select class="ac-insp-role" data-ac-node="role" data-ac-structure="1" aria-label="Роль узла">
                    ${roles.map(r => `<option value="${r}" ${node.role === r ? 'selected' : ''}>${AC_ROLE_LABELS[r]}</option>`).join('')}
                </select>
            </div>
            ${removable ? `<button class="ac-icon-btn ac-icon-btn--danger" data-ac-action="remove-node" title="Удалить узел">${acIcon('trash-2')}</button>` : ''}
        </div>
        <div id="ac-inspector-issues">${acInspectorIssuesHtml()}</div>
        <label class="ac-field">Шаг: что узел делает с задачей
            <textarea class="ac-input" rows="2" data-ac-node="step" placeholder="${node.role === 'supervisor' ? 'Supervisor сам раздаст подзадачи' : 'Например: собери данные о расходе по устройствам'}">${peEscape(node.step)}</textarea>
        </label>
        ${spec.topology === 'workflow' ? acDependsHtml(node) : ''}
        ${dynamic ? `
            <label class="ac-check"><input type="checkbox" data-ac-action="toggle-dynamic" ${node.spec ? '' : 'checked'}>
                <span class="ac-switch"><span></span></span>Собрать агента конфигуратором при запуске</label>` : ''}
        ${node.spec ? acAgentTabsHtml(node.spec) : `<p class="ac-note">${acIcon('sparkles', 3.5)}AgentSpec этого узла соберёт конфигуратор по шагу и задаче при каждом запуске.</p>`}`;
}

function acInspectorIssuesHtml() {
    const node = acSelectedNode();
    const issues = node ? acNodeIssues(node.id) : [];
    return issues.length
        ? `<ul class="ac-issue-list">${issues.map(i => `<li class="ac-issue ac-issue--error">${acIcon('circle-x', 3.5)}<span>${peEscape(i)}</span></li>`).join('')}</ul>`
        : '';
}

function acDependsHtml(node) {
    const others = acState.spec.nodes.filter(n => n.id !== node.id);
    return `
        <div class="ac-field">Получает результаты от
            <div class="ac-tags">${others.length ? others.map(o => `
                <button class="ac-tag ${node.depends_on.includes(o.id) ? 'ac-tag--on' : ''}" data-ac-dep="${o.id}">${acIcon(node.depends_on.includes(o.id) ? 'link' : 'unlink', 3)}${peEscape(o.id)}</button>`).join('') : '<span class="ac-dim__q">нет других шагов</span>'}
            </div>
        </div>`;
}

function acAgentTabsHtml(agent) {
    return `
        <nav class="ac-itabs">${AC_INSPECTOR_TABS.map(([key, icon, label]) => `
            <button class="ac-itab ${acState.inspectorTab === key ? 'ac-itab--on' : ''}" data-ac-itab="${key}">${acIcon(icon, 3.5)}${label}</button>`).join('')}
        </nav>
        <div class="ac-ipane">${{
            role: acRolePaneHtml, model: acModelPaneHtml, tools: acToolsPaneHtml, limits: acLimitsPaneHtml,
        }[acState.inspectorTab](agent)}</div>`;
}

function acTextField(label, path, agent, { rows = 0, lines = false, placeholder = '', type = 'text', attrs = '' } = {}) {
    const value = acPathGet(agent, path);
    const shown = lines ? value.join('\n') : value;
    const typeAttr = lines ? 'data-ac-type="lines"' : type === 'number' ? 'data-ac-type="number"' : '';
    return `<label class="ac-field">${label}${rows
        ? `<textarea class="ac-input" rows="${rows}" data-ac-agent="${path}" ${typeAttr} placeholder="${peEscape(placeholder)}">${peEscape(shown)}</textarea>`
        : `<input class="ac-input" type="${type}" data-ac-agent="${path}" ${typeAttr} ${attrs} value="${peEscape(shown)}" placeholder="${peEscape(placeholder)}">`}</label>`;
}

function acRolePaneHtml(agent) {
    return `
        <div class="ac-grid2">
            ${acTextField('Имя (slug)', 'identity.name', agent, { attrs: 'spellcheck="false"' })}
            ${acTextField('Роль', 'identity.role', agent)}
        </div>
        ${acTextField('Назначение', 'identity.purpose', agent)}
        ${acTextField('Критерии завершения — по одному в строке', 'objective.completion_criteria', agent, { rows: 3, lines: true })}
        ${acTextField('Бриф', 'instructions', agent, { rows: 4, placeholder: 'Шаги, что проверить, что сообщить' })}
        ${acTextField('Факты — по одному в строке', 'context.facts', agent, { rows: 2, lines: true, placeholder: 'Город, предпочтения, известные данные' })}
        <div class="ac-field">Схема результата
            <div class="ac-seg ac-seg--small">${acState.catalog.output_schemas.map(s => `
                <button class="ac-seg__opt ${agent.output.schema_name === s.name ? 'ac-seg__opt--on' : ''}" data-ac-agent-set="output.schema_name:${s.name}" title="${peEscape(s.description)}">${s.name.replace('_v1', '')}</button>`).join('')}
            </div>
        </div>`;
}

function acModelPaneHtml(agent) {
    const catalog = acState.catalog;
    const ladder = catalog.profiles.map((p, i) => `
        <button class="ac-rung ${agent.model.profile === p.name ? 'ac-rung--on' : ''}" data-ac-agent-set="model.profile:${p.name}" style="--level:${i + 1}">
            <span class="ac-rung__bars">${'<i></i>'.repeat(4)}</span>
            <b>${p.name}</b><span title="${peEscape(p.models.join(' → '))}">${peEscape(p.models.map(m => m.replace(/^[a-z-]+\//, '')).join(' → '))} · от $${AC_PROFILE_BUDGET[p.name]}</span>
        </button>`).join('');
    return `
        <div class="ac-field">Профиль сложности — модель выбирает платформа
            <div class="ac-ladder">${ladder}</div>
        </div>
        <div class="ac-field">Reasoning effort
            <div class="ac-seg ac-seg--small">${catalog.efforts.map(e => `
                <button class="ac-seg__opt ${agent.model.effort === e ? 'ac-seg__opt--on' : ''}" data-ac-agent-set="model.effort:${e}">${e}</button>`).join('')}
            </div>
        </div>
        <p class="ac-note">${acIcon('trending-up', 3.5)}При невалидном ответе, невыполненных критериях или зацикливании платформа один раз поднимает профиль на ступень — в пределах потолка.</p>`;
}

function acToolsPaneHtml(agent) {
    const catalog = acState.catalog;
    const propose = acState.spec.autonomy.external_actions === 'propose';
    const tool = t => {
        const write = t.effect === 'write';
        const selected = agent.tools.includes(t.name);
        const blocked = write && !propose && !selected;
        return `<button class="ac-tool ${selected ? 'ac-tool--on' : ''} ${write ? 'ac-tool--write' : ''} ${blocked ? 'ac-tool--blocked' : ''}"
            ${blocked ? 'aria-disabled="true"' : `data-ac-tool="${t.name}"`}
            title="${peEscape(t.description + (blocked ? '\nВключите «Предлагать изменения» в автономности' : ''))}">
            <span class="ac-tool__check">${acIcon(selected ? 'check' : write ? 'pencil' : 'eye', 3)}</span>
            <span class="ac-tool__name">${t.name.replace(/_tool$/, '').replace(/_/g, ' ')}</span>
            ${write ? `<span class="ac-tool__fx">${t.read_actions.length ? 'чтение + ✎' : '✎ на подтверждение'}</span>` : ''}
        </button>`;
    };
    const reads = catalog.tools.filter(t => t.effect !== 'write');
    const writes = catalog.tools.filter(t => t.effect === 'write');
    return `
        <div class="ac-field">Читают мир<div class="ac-tools">${reads.map(tool).join('')}</div></div>
        <div class="ac-field">Меняют мир — только предложения${propose ? '' : ' <em class="ac-em">включите «Предлагать изменения»</em>'}<div class="ac-tools">${writes.map(tool).join('')}</div></div>
        <p class="ac-note">${acIcon(agent.permissions.mode === 'propose_actions' ? 'hand' : 'eye', 3.5)}${agent.permissions.mode === 'propose_actions'
            ? `Предлагает на подтверждение: ${peEscape(agent.permissions.approval_tools.join(', '))}`
            : 'Права агента: только чтение'}</p>
        ${catalog.skills.length ? `
            <div class="ac-field">Skills
                <div class="ac-tags">${catalog.skills.map(s => `
                    <button class="ac-tag ${agent.skills.includes(s.name) ? 'ac-tag--on' : ''}" data-ac-skill="${s.name}" title="${peEscape(s.description)}">${peEscape(s.name)}</button>`).join('')}
                </div>
            </div>` : ''}`;
}

function acLimitsPaneHtml(agent) {
    const limits = acState.catalog.limits.node;
    return `
        <div class="ac-grid2">
            ${acTextField(`Раундов tools · до ${limits.max_iterations}`, 'execution.max_iterations', agent, { type: 'number', attrs: 'min="1" max="8"' })}
            ${acTextField(`Вызовов tools · до ${limits.max_tool_calls}`, 'execution.max_tool_calls', agent, { type: 'number', attrs: 'min="0" max="24"' })}
            ${acTextField(`Таймаут, с · до ${limits.timeout_seconds}`, 'execution.timeout_seconds', agent, { type: 'number', attrs: 'min="10" max="600"' })}
            ${acTextField('Повторов ответа', 'execution.retries', agent, { type: 'number', attrs: 'min="0" max="3"' })}
        </div>
        ${acTextField('Бюджет агента, $', 'budget.max_cost_usd', agent, { type: 'number', attrs: 'step="0.01" min="0"' })}
        <p class="ac-note">${acIcon('scissors', 3.5)}Лимиты выше потолка платформа урежет; каждый шаг получает не больше остатка бюджета системы.</p>`;
}

// --- Run log ---

function acRunLogHtml() {
    const run = acState.run;
    if (!run) {
        return `<div class="ac-runlog__empty">${acIcon('activity', 4)}<span>Журнал запуска появится здесь: шаги агентов, стоимость, итог и предложенные действия.</span></div>`;
    }
    const result = run.result || {};
    const seconds = run.finished_at ? run.finished_at - run.created_at : Date.now() / 1000 - run.created_at;
    const findings = result.findings || [];
    const pill = state => `ac-pill ac-pill--${state === 'waiting_for_approval' ? 'wait' : state}`;
    return `
        <div class="ac-runlog__head">
            <span class="${pill(run.state)}">${run.state === 'running' ? '<span class="ac-led"></span>' : ''}${AC_STATE_LABELS[run.state] || run.state}</span>
            <span class="ac-meter"><b id="ac-elapsed">${seconds.toFixed(0)}</b> с</span>
            <span class="ac-meter"><b>$${run.cost_usd.toFixed(4)}</b></span>
            <span class="ac-meter">${run.steps.length} шаг.</span>
            <span class="ac-meter ${run.demo_mode ? '' : 'ac-meter--real'}">${run.demo_mode ? 'demo' : 'реальные данные'}</span>
            ${run.stop_reason ? `<span class="ac-runlog__why">${peEscape(run.stop_reason)}${run.detail ? ` — ${peEscape(run.detail)}` : ''}</span>` : ''}
        </div>
        <ol class="ac-timeline">${run.steps.map((step, i) => `
            <li class="ac-tl ${acState.openStep === step.run_id ? 'ac-tl--open' : ''}" style="--i:${i}">
                <button class="ac-tl__head" data-ac-step="${step.run_id}">
                    <span class="ac-tl__dot ac-tl__dot--${step.state}"></span>
                    <b>${peEscape(step.node_id)}</b>
                    <span class="ac-tl__phase">${AC_PHASE_LABELS[step.phase] || step.phase.replace('round_', 'раунд ')}</span>
                    <span class="ac-tl__sum">${peEscape(step.summary)}</span>
                    <span class="ac-tl__cost">$${step.cost_usd.toFixed(4)}${step.seconds ? ` · ${step.seconds.toFixed(0)}с` : ''}</span>
                    ${acIcon(acState.openStep === step.run_id ? 'chevron-up' : 'chevron-down', 3.5)}
                </button>
                ${acState.openStep === step.run_id ? acAgentRunHtml(acState.agentRuns[step.run_id], step) : ''}
            </li>`).join('')}
            ${run.state === 'running' ? `<li class="ac-tl ac-tl--pending"><span class="ac-spinner"></span>агенты работают…</li>` : ''}
        </ol>
        ${result.summary ? `
            <article class="ac-result">
                <div class="ac-result__kicker">${acIcon('flag', 3.5)}итог системы</div>
                <p class="ac-result__lead">${peEscape(result.summary)}</p>
                ${result.answer ? `<p class="ac-result__answer">${peEscape(result.answer)}</p>` : ''}
                ${findings.length ? `<ul class="ac-result__list">${findings.map(f => `<li>${peEscape(f)}</li>`).join('')}</ul>` : ''}
                ${(result.criteria || []).length ? `<div class="ac-criteria">${result.criteria.map(c => `
                    <span class="ac-crit ${c.met ? 'ac-crit--met' : 'ac-crit--unmet'}" title="${peEscape(c.evidence)}">${acIcon(c.met ? 'check' : 'x', 3)}${peEscape(c.criterion)}</span>`).join('')}</div>` : ''}
            </article>` : ''}
        ${run.proposed_actions.length ? `
            <article class="ac-result ac-result--actions">
                <div class="ac-result__kicker">${acIcon('hand', 3.5)}предложенные действия — не выполнены</div>
                ${run.proposed_actions.map(a => `<div class="ac-action"><code>${peEscape(a.tool_name)}</code><span>${peEscape((a.arguments || []).map(p => `${p.name}=${p.value}`).join(', '))}</span><em>${peEscape(a.node)} · ${peEscape(a.reason)}</em></div>`).join('')}
            </article>` : ''}`;
}

function acAgentRunHtml(agentRun, step) {
    if (!agentRun) return `<div class="ac-tl__body"><span class="ac-spinner"></span></div>`;
    const result = agentRun.result || {};
    return `
        <div class="ac-tl__body">
            <div class="ac-tl__facts">
                <span>${acIcon('cpu', 3)}${peEscape(agentRun.model || '—')}${agentRun.effort ? ` · ${peEscape(agentRun.effort)}` : ''}</span>
                <span>LLM ×${agentRun.llm_calls}</span><span>tools ×${agentRun.tool_calls}</span>
                ${agentRun.escalations.length ? `<span class="ac-tl__warn">${acIcon('trending-up', 3)}эскалация</span>` : ''}
            </div>
            <p class="ac-tl__summary">${peEscape(step.summary)}</p>
            ${(result.findings || []).length ? `<ul class="ac-result__list">${result.findings.map(f => `<li>${peEscape(f)}</li>`).join('')}</ul>` : ''}
            ${(result.assignments || []).length ? `<ul class="ac-result__list">${result.assignments.map(a => `<li><b>${peEscape(a.worker)}</b> — ${peEscape(a.task)}</li>`).join('')}</ul>` : ''}
            <div class="ac-events">${agentRun.events.map(e => `
                <span class="ac-event ac-event--${e.kind}" title="${peEscape(JSON.stringify(e.detail))}">${AC_EVENT_LABELS[e.kind] || e.kind}${e.detail.tool ? ` · ${peEscape(String(e.detail.tool).replace(/_tool$/, ''))}` : ''}</span>`).join('')}
            </div>
            <div class="ac-tl__ids">run ${peEscape(agentRun.run_id)}${agentRun.trace_id ? ` · trace ${peEscape(agentRun.trace_id)}` : ''}</div>
        </div>`;
}

function acJsonHtml() {
    return `
        <section class="ac-json-box">
            <div class="ac-canvas-head">
                <span class="ac-kicker">${acIcon('braces', 3.5)}AgentSystemSpec</span>
                <button class="ac-add" data-ac-action="apply-json">${acIcon('check', 3)}Применить</button>
            </div>
            <textarea class="ac-json" rows="18" id="ac-json" spellcheck="false">${peEscape(JSON.stringify(acState.spec, null, 2))}</textarea>
        </section>`;
}

// --- Library, runs, theory ---

function acLibraryHtml() {
    if (!acState.systems.length) {
        return `<div class="ac-empty">${acIcon('library', 6)}<h3>Библиотека пуста</h3><p>Соберите систему на верстаке и сохраните её — она появится здесь, и её можно будет поставить на расписание.</p></div>`;
    }
    return `<div class="ac-cards">${acState.systems.map((system, i) => {
        const spec = system.spec || {};
        const scheduled = Boolean(system.schedule_job_id);
        return `
            <article class="ac-card" style="--i:${i}">
                <button class="ac-card__open" data-ac-open="${system.id}">
                    <span class="ac-template__glyph ac-template__glyph--${spec.topology}">${acTemplateGlyph(spec.topology || 'centralized')}</span>
                    <b>${peEscape(system.title)}</b>
                    <span class="ac-card__meta">${peEscape(spec.topology || '?')} · ${(spec.nodes || []).length} узл. · ${peEscape(spec.activation || '')} · ред. ${system.revision}</span>
                    ${system.task ? `<em>${peEscape(system.task)}</em>` : ''}
                    <span class="ac-card__date">${peFormatDate(system.updated_at)}</span>
                </button>
                <div class="ac-card__foot">
                    ${spec.activation === 'scheduled' ? `
                        <button class="ac-add ${scheduled ? 'ac-add--live' : ''}" data-ac-schedule="${system.id}" title="${scheduled ? 'Снять с расписания' : 'Поставить на расписание (сохранённая версия)'}">
                            ${acIcon(scheduled ? 'calendar-check' : 'calendar-clock', 3)}${scheduled ? peEscape((spec.schedule || {}).cron || 'cron') : 'Расписание'}
                        </button>` : '<span></span>'}
                    <button class="ac-icon-btn ac-icon-btn--danger" data-ac-delete="${system.id}" title="Удалить">${acIcon('trash-2', 3.5)}</button>
                </div>
            </article>`;
    }).join('')}</div>`;
}

function acRunsHtml() {
    if (!acState.runs.length) return `<div class="ac-empty">${acIcon('history', 6)}<h3>Запусков нет</h3><p>Здесь видны запуски систем за 7 дней — вручную и по расписанию.</p></div>`;
    return `
        <div class="ac-table-wrap"><table class="ac-table">
            <thead><tr><th>Когда</th><th>Система</th><th>Топология</th><th>Источник</th><th>Статус</th><th class="num">Шаги</th><th class="num">$</th><th class="num">Время</th></tr></thead>
            <tbody>${acState.runs.map(r => `
                <tr data-ac-run="${r.system_run_id}" tabindex="0">
                    <td class="mono">${peFormatDate(new Date(r.created_at * 1000).toISOString())}</td>
                    <td><b>${peEscape(r.name)}</b><div class="ac-table__task">${peEscape(r.task)}</div></td>
                    <td>${acIcon(AC_TOPOLOGY_ICONS[r.topology] || 'blocks', 3.5)} ${peEscape(r.topology || '')}</td>
                    <td>${r.trigger === 'schedule' ? 'расписание' : 'вручную'}${r.demo_mode ? ' · demo' : ''}</td>
                    <td><span class="ac-pill ac-pill--${r.state === 'waiting_for_approval' ? 'wait' : r.state}">${AC_STATE_LABELS[r.state] || r.state}</span></td>
                    <td class="num mono">${r.steps}</td><td class="num mono">${r.cost_usd.toFixed(4)}</td><td class="num mono">${r.seconds ? `${r.seconds.toFixed(0)}с` : '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table></div>`;
}

function acTheoryHtml() {
    const catalog = acState.catalog;
    const option = o => `<li class="${o.available ? '' : 'ac-off'}"><b>${peEscape(o.label)}</b><span>${peEscape(o.description)}</span>${o.available ? '' : `<em>${acIcon('lock', 3)}${peEscape(o.reason)}</em>`}</li>`;
    return `
        <div class="ac-theory">
            <p class="ac-theory__lead">Четырнадцать популярных «паттернов» описывают разные уровни системы: <i>ReAct</i> — цикл шага, <i>DAG</i> — граф исполнения, <i>Supervisor</i> — топологию, <i>Event-driven</i> — запуск. Поэтому система здесь задаётся <b>пятью независимыми измерениями</b>, а поведенческие паттерны — способ выполнения шага.</p>
            <div class="ac-theory__grid">
                ${catalog.dimensions.map((d, i) => `
                    <section class="ac-theory__card" style="--i:${i}"><span class="ac-dim__num">0${i + 1}</span><h3>${peEscape(d.label)}</h3><p>${peEscape(d.question)}</p><ul>${d.options.map(option).join('')}</ul></section>`).join('')}
                <section class="ac-theory__card" style="--i:4"><span class="ac-dim__num">05</span><h3>Автономность</h3><p>Отдельные полномочия: агент может планировать, но не иметь права менять мир.</p><ul>${catalog.autonomy.map(option).join('')}</ul></section>
                <section class="ac-theory__card ac-theory__card--rules" style="--i:5"><span class="ac-dim__num">§</span><h3>Что гарантирует платформа</h3><ul>
                    <li><b>Валидатор</b><span>Каждый AgentSpec проверяется: tools только из разрешённых, лимиты урезаются до потолков.</span></li>
                    <li><b>Без исполнения</b><span>Write-tools агента не выполняются — только предложения на подтверждение.</span></li>
                    <li><b>Без пересказа</b><span>Агенты передают друг другу итог и выводы, полные данные остаются в их запусках.</span></li>
                    <li><b>Общий бюджет</b><span>Шаг получает не больше остатка бюджета системы. Дневной лимит всех агентов — $${catalog.limits.daily_cost_usd}.</span></li>
                    <li><b>Сначала один</b><span>Команда делает простую задачу хуже и дороже — композитор начинает с одного агента.</span></li>
                </ul></section>
            </div>
        </div>`;
}

// --- Actions ---

function acLoadSpec(spec, { title = '', task = '', systemId = null, revision = null, demo = acState.demo, scheduleJobId = '', pristine = false } = {}) {
    acState.spec = spec;
    acState.title = title;
    acState.task = task || spec.task || '';
    acState.systemId = systemId;
    acState.revision = revision;
    acState.demo = demo;
    acState.scheduleJobId = scheduleJobId;
    acState.selected = spec.nodes[0] ? spec.nodes[0].id : null;
    acState.inspectorTab = 'role';
    acState.pristine = pristine;
    acState.dirty = !systemId && !pristine;
    acState.check = null;
    acState.run = null;
    acState.openStep = null;
    acState.tab = 'build';
    acSyncPermissions(spec);
    acRender();
    acValidate();
}

async function acCompose() {
    if (!acState.task.trim()) {
        acSetError('Опишите задачу — композитор строит систему по ней');
        document.getElementById('ac-task')?.focus();
        return;
    }
    acState.composing = true;
    acState.error = null;
    acRenderMessages();
    const button = document.querySelector('[data-ac-action="compose"]');
    if (button) { button.disabled = true; button.innerHTML = '<span class="ac-spinner"></span>Композитор думает…'; }
    try {
        const result = await acPost('/compose/', { task: acState.task, topology: acState.composeTopology });
        if (!result.spec) throw new Error(result.reason || (result.errors || []).join('; ') || 'Композитор не предложил систему');
        acState.composeReason = `${result.reason} · $${result.cost_usd.toFixed(4)} · ${result.model}`;
        acState.composing = false;
        const spec = result.spec;
        spec.task = acState.task;
        acLoadSpec(spec, { title: acState.title || spec.name.replace(/_/g, ' '), task: acState.task });
    } catch (error) {
        acState.composing = false;
        acRenderBuild();
        acSetError(error);
    }
}

async function acSave(copy = false) {
    if (!acState.title.trim()) {
        acSetError('Дайте системе название — поле слева вверху');
        document.querySelector('.ac-title-input')?.focus();
        return;
    }
    acState.spec.task = acState.task;
    const body = { title: acState.title, spec: acState.spec, task: acState.task, demo_mode: acState.demo };
    try {
        const saved = acState.systemId && !copy
            ? await acPost(`/systems/${acState.systemId}/`, body, 'PUT')
            : await acPost('/systems/', body);
        acState.systemId = saved.id;
        acState.revision = saved.revision;
        acState.dirty = false;
        acState.pristine = false;
        acNotify(`«${saved.title}» сохранена, редакция ${saved.revision}${saved.schedule_job_id ? '. Расписание использует прошлую версию — поставьте его заново в библиотеке' : ''}`);
        acRenderPart('ac-save', acSaveHtml);
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
        acState.pristine = false;
        await acPollRun(started.system_run_id);
        document.getElementById('ac-runlog')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        acSetError(error);
    }
}

function acRenderRun() {
    acRenderPart('ac-runlog', acRunLogHtml);
    acRenderPart('ac-canvas', acCanvasHtml);
    acRenderPart('ac-runbar', acRunBarHtml);
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
    acRenderRun();
    clearInterval(acState.tickTimer);
    if (acState.run.state === 'running' && acState.active) {
        acState.pollTimer = setTimeout(() => acPollRun(runId), AC_POLL_MS);
        acState.tickTimer = setInterval(() => {
            const el = document.getElementById('ac-elapsed');
            if (el && acState.run) el.textContent = (Date.now() / 1000 - acState.run.created_at).toFixed(0);
        }, 1000);
    }
}

async function acOpenStep(runId) {
    acState.openStep = acState.openStep === runId ? null : runId;
    acRenderPart('ac-runlog', acRunLogHtml);
    if (!acState.openStep || acState.agentRuns[runId]) return;
    try {
        acState.agentRuns[runId] = await acFetch(`/agent-runs/${runId}/`);
    } catch (error) {
        acSetError(error);
    }
    acRenderPart('ac-runlog', acRunLogHtml);
}

async function acLoadLibrary() {
    acState.systems = (await acFetch('/systems/')).systems;
}

async function acLoadRuns() {
    acState.runs = await acFetch('/runs/?limit=50');
}

async function acOpenRun(runId) {
    const run = await acFetch(`/runs/${runId}/`);
    acLoadSpec(run.spec, { title: run.name.replace(/_/g, ' '), task: run.task, demo: run.demo_mode });
    acState.run = run;
    acState.dirty = false;
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

function acSelect(nodeId) {
    acState.selected = nodeId;
    acRenderPart('ac-canvas', acCanvasHtml);
    acRenderPart('ac-inspector', acInspectorHtml);
}

function acClick(event) {
    const target = event.target.closest('button, input[type="checkbox"], tr[data-ac-run]');
    if (!target || !acState.catalog || target.getAttribute('aria-disabled') === 'true') return;
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
    if (data.acTemplate) {
        const template = AC_TEMPLATES[Number(data.acTemplate)];
        acLoadSpec(acFromTemplate(template), { title: template.title, task: acState.task || template.task });
        return;
    }
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
        const system = acState.systems.find(s => s.id === id);
        if (!confirm(`Удалить «${system ? system.title : id}» из библиотеки?`)) return;
        acFetch(`/systems/${id}/`, { method: 'DELETE' })
            .then(() => { if (acState.systemId === id) acState.systemId = null; return acLoadLibrary(); })
            .then(acRenderBody).catch(acSetError);
        return;
    }
    if (data.acSchedule) { acToggleSchedule(Number(data.acSchedule)); return; }
    if (data.acItab) { acState.inspectorTab = data.acItab; acRenderPart('ac-inspector', acInspectorHtml); return; }
    if (data.acDim) {
        const [name, value] = data.acDim.split(':');
        if (name === 'topology') acApplyTopology(spec, value);
        else spec[name] = value;
        if (name === 'dynamism' && value !== 'dynamic') {
            spec.nodes.forEach(n => { if (!n.spec) n.spec = acNewAgent(n.id); });
        }
        if (!spec.nodes.some(n => n.id === acState.selected)) acState.selected = spec.nodes[0].id;
        acState.pristine = false;
        acSpecChanged({ structure: true });
        if (name === 'activation' || name === 'dynamism') {
            const bar = document.querySelector('.ac-taskbar');
            if (bar) { bar.outerHTML = acTaskBarHtml(); lucide.createIcons({ nodes: [document.querySelector('.ac-taskbar')] }); }
        }
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
    if (data.acRounds) { spec.coordination.debate_rounds = Number(data.acRounds); acSpecChanged({ structure: true }); return; }
    if (data.acSelect) { acSelect(data.acSelect); return; }
    if (data.acAdd) {
        let index = spec.nodes.length + 1;
        while (spec.nodes.some(n => n.id === `${data.acAdd}${index}`)) index += 1;
        const node = acNewNode(`${data.acAdd}${index}`, data.acAdd);
        if (spec.dynamism === 'dynamic') node.spec = null;
        const tail = spec.nodes.findIndex(n => n.role === 'aggregator');
        if (data.acAdd === 'aggregator' || tail < 0) spec.nodes.push(node);
        else spec.nodes.splice(tail, 0, node);
        if (spec.topology === 'workflow') node.depends_on = [spec.nodes[spec.nodes.length - 2].id];
        acState.selected = node.id;
        acState.pristine = false;
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
        if (path === 'model.profile' && (node.spec.budget.max_cost_usd || 0) < AC_PROFILE_BUDGET[value]) {
            node.spec.budget.max_cost_usd = AC_PROFILE_BUDGET[value];
            acNotify(`Бюджет узла поднят до $${AC_PROFILE_BUDGET[value]} — меньше ${value} не хватит на один запуск`);
        }
        acSpecChanged({ structure: true });
        return;
    }
    switch (data.acAction) {
        case 'new':
            if (acState.dirty && !confirm('Несохранённые изменения пропадут. Начать новую систему?')) return;
            acState.composeReason = '';
            acLoadSpec(acBaseSystem(), { pristine: true });
            break;
        case 'compose': acCompose(); break;
        case 'save': acSave(false); break;
        case 'save-copy': acSave(true); break;
        case 'run': acStartRun(); break;
        case 'cancel': acFetch(`/runs/${acState.run.system_run_id}/cancel/`, { method: 'POST' }).catch(acSetError); break;
        case 'mode-demo': acState.demo = true; acRenderPart('ac-runbar', acRunBarHtml); break;
        case 'mode-real': acState.demo = false; acRenderPart('ac-runbar', acRunBarHtml); break;
        case 'dismiss': acSetError(null); break;
        case 'goto-issues': document.getElementById('ac-issues')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
        case 'toggle-json': acState.showJson = !acState.showJson; acRenderBuild(); break;
        case 'apply-json':
            try {
                const parsed = JSON.parse(document.getElementById('ac-json').value);
                acLoadSpec(parsed, { title: acState.title, task: acState.task, systemId: acState.systemId, revision: acState.revision });
                acState.dirty = true;
                acRenderPart('ac-save', acSaveHtml);
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

// Text fields change the spec without re-rendering their own zone (keeps focus)
function acInput(event) {
    const element = event.target;
    const data = element.dataset;
    if (data.acField) {
        acState[data.acField] = element.value;
        if (data.acField !== 'composeTopology') acMarkDirty();
        return;
    }
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
        acRenderPart('ac-canvas', acCanvasHtml);
        acRenderPart('ac-inspector', acInspectorHtml);
        return;
    }
    if (element.dataset.acAgent === 'identity.name' || element.dataset.acNode === 'step' || element.dataset.acAgent?.startsWith('model')) {
        acRenderPart('ac-canvas', acCanvasHtml);
    }
}

function acKeydown(event) {
    if (!acState.active || acState.tab !== 'build') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        acSave(false);
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (acState.check && acState.check.valid && !(acState.run && acState.run.state === 'running')) acStartRun();
    }
}

function initAgentConstructor() {
    const root = document.getElementById('constructor-root');
    if (!root) return;
    root.addEventListener('click', acClick);
    root.addEventListener('input', acInput);
    root.addEventListener('change', acChange);
    document.addEventListener('keydown', acKeydown);
    root.addEventListener('keydown', event => {
        const row = event.target.closest('tr[data-ac-run]');
        if (row && event.key === 'Enter') acOpenRun(row.dataset.acRun).catch(acSetError);
    });
}

async function acEnsureCatalog() {
    if (acState.catalog) return;
    acState.catalog = await acFetch('/catalog/');
    if (!acState.spec) acLoadSpec(acBaseSystem(), { pristine: true });
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
    clearInterval(acState.tickTimer);
}

window.showConstructorView = showConstructorView;
window.hideConstructorView = hideConstructorView;

document.addEventListener('DOMContentLoaded', initAgentConstructor);
