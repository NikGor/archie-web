// Prompt test suite (ARCHIE-208): overview per prompt, run launcher, live progress,
// run history and run comparison.
// Live progress: WS to the agent's /ws_evals/{run_id}; history: Django /prompt-evals/api/.
// Protocol: archie_shared.evals.models (EvalServerEvent, EvalCaseResult, EvalRunInfo).

const PE_API = '/prompt-evals/api';
const PE_JIRA_URL = 'https://badich.atlassian.net/browse/';
const PE_TOKENS_PER_ATTEMPT = { stage1: 8000, full: 20000 };
const PE_TABS = [
    { id: 'overview', label: 'Обзор', icon: 'layout-list' },
    { id: 'cases', label: 'Кейсы', icon: 'file-pen-line' },
    { id: 'launch', label: 'Запуск', icon: 'play' },
    { id: 'run', label: 'Прогон', icon: 'activity' },
    { id: 'history', label: 'История', icon: 'history' },
    { id: 'compare', label: 'Сравнение', icon: 'git-compare' },
];
const PE_STATUS_LABELS = {
    passed: 'проходит', failed: 'падает', flaky: 'нестабилен', mixed: 'зависит от модели', never: 'не запускался',
    error: 'ошибка', queued: 'в очереди', running: 'идёт', completed: 'завершён',
    cancelled: 'отменён',
};

const peState = {
    active: false,
    tab: 'overview',
    catalog: null,
    overview: null,
    runs: [],
    historyFilter: { model: '', prompt: '' },
    selectedRuns: new Set(),
    launch: { caseIds: new Set(), models: new Set(), repeats: 1, judge: false, judgeModel: '', reason: '', jira: '', modelFilter: '' },
    view: null,          // run shown in the "Прогон" tab: {run, cases, results, running, live}
    ws: null,
    openDetails: new Set(),
    error: null,
};

// --- Helpers ---

function peEscape(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function peFormatDate(iso) {
    if (!iso) return '—';
    // dd.mm.yyyy hh:mm regardless of the browser locale
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).replace(',', '');
}

function peFormatDuration(ms) {
    if (ms == null) return '—';
    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

function peFormatTokens(tokens) {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens || 0);
}

// Russian plural: pePlural(4, ['кейс', 'кейса', 'кейсов']) -> '4 кейса'
function pePlural(count, forms) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const form = mod10 === 1 && mod100 !== 11 ? forms[0]
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
    return `${count} ${form}`;
}
const PE_CASE_FORMS = ['кейс', 'кейса', 'кейсов'];
const PE_MODEL_FORMS = ['модель', 'модели', 'моделей'];
const PE_ATTEMPT_FORMS = ['попытка', 'попытки', 'попыток'];

function peMean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function peMedian(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function peJudgeMean(judge) {
    return (judge.ui_optimality + judge.content_informativeness + judge.prompt_following) / 3;
}

// Main prompt of a case: its format prompt if any, else the command prompt.
function pePrimaryPrompt(testCase) {
    return testCase.prompts[testCase.prompts.length - 1];
}

function pePromptDescription(prompt) {
    return (peState.catalog && peState.catalog.prompt_descriptions[prompt]) || '';
}

// Group heading: prompt name and what the prompt is responsible for.
function pePromptTitle(prompt, extra = '') {
    const description = pePromptDescription(prompt);
    return `<div class="pe-group__title"><span class="pe-group__name">${peEscape(prompt)}</span>${extra}
        ${description ? `<span class="pe-group__desc">${peEscape(description)}</span>` : ''}</div>`;
}

// Case status over several models: flaky = one model both passes and fails,
// mixed = models disagree.
function peCaseStatus(results) {
    if (!results.length) return 'never';
    const byModel = {};
    results.forEach(r => { (byModel[r.model] = byModel[r.model] || []).push(r.status); });
    const statuses = new Set(Object.values(byModel).map(peAttemptsStatus));
    if (statuses.has('flaky')) return 'flaky';
    return statuses.size === 1 ? [...statuses][0] : 'mixed';
}

function peAttemptsStatus(statuses) {
    if (!statuses.length) return 'never';
    const passed = statuses.filter(s => s === 'passed').length;
    if (passed === statuses.length) return 'passed';
    return passed === 0 ? 'failed' : 'flaky';
}

async function peFetch(path, options = {}) {
    const response = await fetch(`${PE_API}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken'), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

function peSetError(error) {
    peState.error = error ? String(error.message || error) : null;
    const box = document.getElementById('pe-error');
    if (!box) return;
    box.textContent = peState.error || '';
    box.classList.toggle('hidden', !peState.error);
}

// --- Data loading ---

async function peLoadCatalog() {
    peState.catalog = await peFetch('/catalog/');
    if (peState.catalog.agent_error) console.error('[PromptEvals] agent catalog:', peState.catalog.agent_error);
    if (!peState.launch.models.size && peState.catalog.default_model) peState.launch.models.add(peState.catalog.default_model);
    if (!peState.launch.judgeModel) peState.launch.judgeModel = peState.catalog.default_model;
}

async function peLoadOverview() {
    peState.overview = (await peFetch('/overview/')).prompts;
}

async function peLoadRuns() {
    const params = new URLSearchParams();
    if (peState.historyFilter.model) params.set('model', peState.historyFilter.model);
    if (peState.historyFilter.prompt) params.set('prompt', peState.historyFilter.prompt);
    peState.runs = (await peFetch(`/runs/?${params}`)).runs;
}

async function peOpenStoredRun(runId) {
    const detail = await peFetch(`/runs/${runId}/`);
    peState.view = { run: detail.run, cases: detail.cases, results: detail.results, running: {}, live: false };
    peState.openDetails.clear();
    peSwitchTab('run');
}

// --- Live run over WebSocket ---

function peAttemptKey(ref) {
    return `${ref.case_id}|${ref.model}|${ref.attempt}`;
}

function peNormalizeRun(info) {
    // EvalRunInfo (agent) -> the flat shape Django returns
    return {
        ...info,
        reason: info.request.reason,
        jira_key: info.request.jira_key || '',
        triggered_by: info.request.triggered_by,
        models: info.request.models,
        repeats: info.request.repeats,
        judge_model: info.request.judge_model || '',
    };
}

function peConnectRun(runId) {
    peDisconnectRun();
    const ws = new WebSocket(`${window.AI_AGENT_WS_URL}/ws_evals/${runId}`);
    peState.ws = ws;
    ws.onmessage = (message) => peHandleEvent(JSON.parse(message.data));
    ws.onerror = () => peSetError('Нет связи с агентом: прогресс прогона недоступен');
    ws.onclose = () => { if (peState.ws === ws) peState.ws = null; };
}

function peDisconnectRun() {
    if (peState.ws) {
        const ws = peState.ws;
        peState.ws = null;
        ws.close();
    }
}

function peHandleEvent(event) {
    if (event.type === 'error') { peSetError(event.message); return; }
    if (event.type === 'snapshot') {
        const running = {};
        event.running.forEach(ref => { running[peAttemptKey(ref)] = ref; });
        peState.view = { run: peNormalizeRun(event.run), cases: event.cases, results: event.results, running, live: true };
    } else if (!peState.view || !peState.view.live) {
        return;
    } else if (event.type === 'attempt_started' || event.type === 'attempt_step') {
        peState.view.running[peAttemptKey(event.attempt)] = event.attempt;
    } else if (event.type === 'attempt_finished') {
        delete peState.view.running[peAttemptKey(event.result)];
        peState.view.results.push(event.result);
        peState.view.run = peNormalizeRun(event.run);
    } else if (event.type === 'run_finished') {
        peState.view.run = peNormalizeRun(event.run);
        peState.view.running = {};
        peState.overview = null;
        peUpdateLiveBadge();
    }
    if (peState.tab === 'run') peRenderBody();
    peUpdateLiveBadge();
}

async function peAttachActiveRun() {
    const { run } = await peFetch('/runs/active/');
    if (run) peConnectRun(run.run_id);
}

function peIsRunActive() {
    return Boolean(peState.view && peState.view.live && ['queued', 'running'].includes(peState.view.run.status));
}

function peUpdateLiveBadge() {
    const badge = document.getElementById('pe-live-badge');
    if (!badge) return;
    const view = peState.view;
    badge.classList.toggle('hidden', !peIsRunActive());
    if (peIsRunActive()) badge.textContent = `${view.run.done_attempts}/${view.run.total_attempts}`;
}

// --- Rendering: shell ---

function peSwitchTab(tab) {
    peState.tab = tab;
    document.querySelectorAll('#prompts-root .pe-tab').forEach(el => el.classList.toggle('pe-tab--active', el.dataset.tab === tab));
    peRenderBody();
}

async function peRenderBody() {
    const body = document.getElementById('pe-body');
    if (!body) return;
    const renderers = { overview: peRenderOverview, cases: peRenderCases, launch: peRenderLaunch, run: peRenderRun, history: peRenderHistory, compare: peRenderCompare };
    try {
        body.innerHTML = await renderers[peState.tab]();
        peSetError(null);
    } catch (error) {
        body.innerHTML = '<div class="pe-empty">Не удалось загрузить данные</div>';
        peSetError(error);
    }
    lucide.createIcons({ nodes: [body] });
}

function peStatusPill(status) {
    return `<span class="pe-pill pe-pill--${status}">${peEscape(PE_STATUS_LABELS[status] || status)}</span>`;
}

// --- Overview ---

const PE_FAILING_STATUSES = new Set(['failed', 'flaky', 'mixed']);

// Overview cases whose latest results have failures -> cases and failing models.
function peOverviewFailing(prompt = null) {
    const cases = new Map();
    peState.overview.filter(item => !prompt || item.prompt === prompt).forEach(item => {
        item.cases.filter(c => PE_FAILING_STATUSES.has(c.status)).forEach(c => cases.set(c.case.id, c));
    });
    const models = new Set();
    cases.forEach(c => Object.entries(c.models).forEach(([model, r]) => { if (r.passed < r.total) models.add(model); }));
    return { caseIds: [...cases.keys()], models: [...models] };
}

function peOverviewRerunButton(prompt = null) {
    if (peIsRunActive()) return '';
    const { caseIds, models } = peOverviewFailing(prompt);
    if (!caseIds.length) return '';
    return `<button class="pe-btn ${prompt ? 'pe-btn--ghost' : ''}" data-action="rerun-overview" ${prompt ? `data-prompt="${peEscape(prompt)}"` : ''}
        title="${peEscape(`${caseIds.join(', ')} на ${models.join(', ')}`)}">
        <i data-lucide="rotate-ccw" class="w-4 h-4"></i> Перезапустить упавшие${prompt ? ' промпта' : ''} (${pePlural(caseIds.length, PE_CASE_FORMS)} × ${pePlural(models.length, PE_MODEL_FORMS)})</button>`;
}

async function peRerunOverview(prompt) {
    const { caseIds, models } = peOverviewFailing(prompt);
    if (!caseIds.length) return;
    const run = await peFetch('/runs/start/', {
        method: 'POST',
        body: JSON.stringify({
            case_ids: caseIds,
            models,
            repeats: 1,
            reason: prompt ? `Перезапуск упавших кейсов промпта ${prompt}` : 'Перезапуск упавших кейсов из обзора',
        }),
    });
    peState.openDetails.clear();
    peConnectRun(run.run_id);
    peSwitchTab('run');
}

async function peRenderOverview() {
    if (!peState.overview) await peLoadOverview();
    if (!peState.overview.length) return '<div class="pe-empty">Каталог кейсов пуст</div>';
    const toolbar = peOverviewRerunButton();
    return `${toolbar ? `<div class="pe-overview__toolbar">${toolbar}</div>` : ''}<div class="pe-overview">${peState.overview.map(item => {
        const counts = { passed: 0, mixed: 0, flaky: 0, failed: 0, never: 0 };
        item.cases.forEach(c => { counts[c.status] += 1; });
        const open = peState.openDetails.has(`prompt:${item.prompt}`);
        return `
        <div class="pe-prompt pe-prompt--${item.status}">
            <button class="pe-prompt__head" data-action="toggle" data-key="prompt:${peEscape(item.prompt)}">
                <span class="pe-prompt__dot"></span>
                <span class="pe-prompt__title">
                    <span class="pe-prompt__name">${peEscape(item.prompt)}</span>
                    ${item.description ? `<span class="pe-prompt__desc">${peEscape(item.description)}</span>` : ''}
                </span>
                ${item.changed_since_run ? '<span class="pe-badge pe-badge--warn" title="Шаблон изменён после последнего прогона">изменён</span>' : ''}
                <span class="pe-prompt__counts">
                    ${counts.passed ? `<span class="pe-count pe-count--passed">${counts.passed}</span>` : ''}
                    ${counts.mixed ? `<span class="pe-count pe-count--mixed" title="зависит от модели">${counts.mixed}</span>` : ''}
                    ${counts.flaky ? `<span class="pe-count pe-count--flaky" title="нестабилен">${counts.flaky}</span>` : ''}
                    ${counts.failed ? `<span class="pe-count pe-count--failed">${counts.failed}</span>` : ''}
                    ${counts.never ? `<span class="pe-count pe-count--never">${counts.never}</span>` : ''}
                </span>
                <span class="pe-prompt__meta">${item.last_run_at ? peFormatDate(item.last_run_at) : 'не запускался'}</span>
                <i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4"></i>
            </button>
            ${open ? `
            <div class="pe-prompt__cases">
                ${item.cases.map(c => `
                <div class="pe-case-row">
                    ${peStatusPill(c.status)}
                    <div class="pe-case-row__main">
                        <div class="pe-case-row__name">${peEscape(c.case.name)} <span class="pe-muted">${peEscape(c.case.id)}</span></div>
                        <div class="pe-case-row__desc">${peEscape(c.case.description)}</div>
                    </div>
                    <div class="pe-case-row__models">${Object.entries(c.models).map(([model, r]) =>
                        `<span class="pe-chip" title="${peEscape(model)}">${peEscape(model)}: ${r.passed}/${r.total}</span>`).join('')}</div>
                    ${c.run_id ? `<button class="pe-icon-btn" data-action="open-run" data-run="${c.run_id}" title="Открыть прогон"><i data-lucide="external-link" class="w-4 h-4"></i></button>` : ''}
                    <button class="pe-icon-btn" data-action="case-edit" data-case="${peEscape(c.case.id)}" title="Редактировать кейс"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                    <button class="pe-icon-btn" data-action="prefill" data-cases="${peEscape(c.case.id)}" title="Запустить кейс"><i data-lucide="play" class="w-4 h-4"></i></button>
                </div>`).join('')}
                <div class="pe-prompt__actions">
                    <button class="pe-btn pe-btn--ghost" data-action="prefill" data-cases="${peEscape(item.cases.map(c => c.case.id).join(','))}">
                        <i data-lucide="play" class="w-4 h-4"></i> Запустить все кейсы промпта
                    </button>
                    ${peOverviewRerunButton(item.prompt)}
                </div>
            </div>` : ''}
        </div>`;
    }).join('')}</div>`;
}

// --- Launch ---

// 'on' if all cases of the chip are selected, 'partial' if some, 'off' if none.
function peChipState(cases) {
    const selected = cases.filter(c => peState.launch.caseIds.has(c.id)).length;
    if (!selected) return 'off';
    return selected === cases.length ? 'on' : 'partial';
}

function peChipCases(kind, value) {
    return peState.catalog.cases.filter(c => (kind === 'prompt' ? c.prompts : c.tags).includes(value));
}

function peChip(kind, value) {
    const state = peChipState(peChipCases(kind, value));
    return `<button type="button" class="pe-chip pe-chip--btn pe-chip--${state}" data-action="toggle-chip" data-kind="${kind}" data-value="${peEscape(value)}" aria-pressed="${state === 'on'}">${peEscape(value)}</button>`;
}

function peEstimate() {
    const cases = peState.catalog.cases.filter(c => peState.launch.caseIds.has(c.id));
    const perModel = cases.reduce((sum, c) => sum + PE_TOKENS_PER_ATTEMPT[c.stage], 0);
    const factor = peState.launch.models.size * peState.launch.repeats;
    return { attempts: cases.length * factor, tokens: perModel * factor };
}

async function peRenderLaunch() {
    if (!peState.catalog) await peLoadCatalog();
    const launch = peState.launch;
    const bySuite = {};
    peState.catalog.cases.forEach(c => { (bySuite[c.suite] = bySuite[c.suite] || []).push(c); });
    const prompts = [...new Set(peState.catalog.cases.flatMap(c => c.prompts))].sort();
    const tags = [...new Set(peState.catalog.cases.flatMap(c => c.tags))].sort();
    const models = peState.catalog.models.filter(m => !launch.modelFilter || m.includes(launch.modelFilter));
    const estimate = peEstimate();
    return `
    <form id="pe-launch-form" class="pe-launch">
        <section class="pe-section">
            <div class="pe-section__title">Кейсы <span class="pe-muted">${launch.caseIds.size} из ${peState.catalog.cases.length} выбрано</span>
                <span class="pe-section__actions">
                    <button type="button" class="pe-btn pe-btn--ghost pe-btn--small" data-action="select-all">Выбрать все</button>
                    <button type="button" class="pe-btn pe-btn--ghost pe-btn--small" data-action="select-none" ${launch.caseIds.size ? '' : 'disabled'}>Снять все</button>
                </span>
            </div>
            <div class="pe-quick">
                <span class="pe-muted">Промпт:</span>
                ${prompts.map(p => peChip('prompt', p)).join('')}
            </div>
            <div class="pe-quick">
                <span class="pe-muted">Тег:</span>
                ${tags.map(t => peChip('tag', t)).join('')}
            </div>
            <div class="pe-suites">
                ${Object.entries(bySuite).map(([suite, cases]) => {
                    const all = cases.every(c => launch.caseIds.has(c.id));
                    return `
                    <div class="pe-suite">
                        <label class="pe-check pe-check--suite"><input type="checkbox" data-action="toggle-suite" data-suite="${peEscape(suite)}" ${all ? 'checked' : ''}> ${peEscape(suite)}</label>
                        ${cases.map(c => `
                        <label class="pe-check" title="${peEscape(c.description)}">
                            <input type="checkbox" data-action="toggle-case" data-case="${peEscape(c.id)}" ${launch.caseIds.has(c.id) ? 'checked' : ''}>
                            <span>${peEscape(c.name)}</span> <span class="pe-muted">${peEscape(c.id)}${c.judge ? ' · judge' : ''}</span>
                        </label>`).join('')}
                    </div>`;
                }).join('')}
            </div>
        </section>
        <section class="pe-section">
            <div class="pe-section__title">На каких моделях прогнать
                <span class="pe-muted">каждый кейс запускается на каждой выбранной модели</span></div>
            ${peState.catalog.models.length ? `
            <div class="pe-quick pe-selected-models">
                ${launch.models.size ? [...launch.models].map(m => `
                <button type="button" class="pe-chip pe-chip--btn pe-chip--on" data-action="remove-model" data-model="${peEscape(m)}" title="Убрать модель">
                    ${peEscape(m)}${m === peState.catalog.default_model ? ' · по умолчанию' : ''} ✕</button>`).join('')
                : '<span class="pe-error-inline">Модель не выбрана — отметьте хотя бы одну ниже</span>'}
            </div>
            <input class="pe-input" data-action="model-filter" placeholder="Фильтр моделей…" value="${peEscape(launch.modelFilter)}">
            <div class="pe-models">
                ${models.map(m => `
                <label class="pe-check"><input type="checkbox" data-action="toggle-model" data-model="${peEscape(m)}" ${launch.models.has(m) ? 'checked' : ''}> ${peEscape(m)}</label>`).join('')
                || '<span class="pe-muted">Нет моделей по фильтру</span>'}
            </div>` : `
            <div class="pe-error-line">Список моделей не загрузился: агент не ответил.
                ${peState.catalog.agent_error ? `<div class="pe-muted">${peEscape(peState.catalog.agent_error)}</div>` : ''}
                Проверьте, что агент запущен и собран с последним кодом, затем нажмите ⟳ вверху.</div>`}
        </section>
        <section class="pe-section pe-section--row">
            <label class="pe-field">Повторов
                <input class="pe-input pe-input--short" type="number" min="1" max="10" data-action="repeats" value="${launch.repeats}">
            </label>
            <label class="pe-check"><input type="checkbox" data-action="judge" ${launch.judge ? 'checked' : ''}> LLM-judge</label>
            <label class="pe-field ${launch.judge ? '' : 'hidden'}">Модель judge
                <select class="pe-input" data-action="judge-model">
                    ${peState.catalog.models.filter(m => m.startsWith('gpt')).map(m => `<option ${m === launch.judgeModel ? 'selected' : ''}>${peEscape(m)}</option>`).join('')}
                </select>
            </label>
        </section>
        <section class="pe-section">
            <label class="pe-field pe-field--wide">Зачем запуск (необязательно)
                <input class="pe-input" data-action="reason" placeholder="Например: после правки format_ui_answer — погода через weather_card" value="${peEscape(launch.reason)}">
            </label>
            <label class="pe-field">JIRA
                <input class="pe-input pe-input--short" data-action="jira" placeholder="ARCHIE-…" value="${peEscape(launch.jira)}">
            </label>
        </section>
        <div class="pe-launch__footer">
            <span id="pe-estimate" class="pe-muted">${pePlural(launch.caseIds.size, PE_CASE_FORMS)} × ${pePlural(launch.models.size, PE_MODEL_FORMS)} × ${launch.repeats} = ${pePlural(estimate.attempts, PE_ATTEMPT_FORMS)} · ~${peFormatTokens(estimate.tokens)} токенов</span>
            <button type="submit" class="pe-btn" ${peIsRunActive() ? 'disabled title="Дождитесь окончания текущего прогона"'
                : !launch.models.size || !launch.caseIds.size ? 'disabled title="Выберите кейсы и модель"' : ''}>
                <i data-lucide="play" class="w-4 h-4"></i> Запустить
            </button>
        </div>
    </form>`;
}

function pePrefill(caseIds) {
    peState.launch.caseIds = new Set(caseIds);
    peSwitchTab('launch');
}

async function peStartRun() {
    const launch = peState.launch;
    if (!launch.caseIds.size || !launch.models.size) { peSetError('Выберите кейсы и модели'); return; }
    const run = await peFetch('/runs/start/', {
        method: 'POST',
        body: JSON.stringify({
            case_ids: [...launch.caseIds],
            models: [...launch.models],
            repeats: launch.repeats,
            judge: launch.judge,
            judge_model: launch.judge ? launch.judgeModel : null,
            reason: launch.reason.trim(),
            jira_key: launch.jira.trim() || null,
        }),
    });
    launch.reason = '';
    peState.openDetails.clear();
    peConnectRun(run.run_id);
    peSwitchTab('run');
}

// --- Run view (live or stored) ---

// Failed or errored attempts of a run -> cases and models to run again.
// A run is cases x models, so combinations that passed may run again too.
function peFailedSelection(view) {
    const failed = view.results.filter(r => r.status !== 'passed');
    const enabled = new Set((peState.catalog ? peState.catalog.cases : []).map(c => c.id));
    const caseIds = [...new Set(failed.map(r => r.case_id))];
    return {
        caseIds: caseIds.filter(id => enabled.has(id)),
        skipped: caseIds.filter(id => !enabled.has(id)),
        models: [...new Set(failed.map(r => r.model))],
    };
}

function peRerunButton(view, compact = false) {
    if (['queued', 'running'].includes(view.run.status) || !view.results.some(r => r.status !== 'passed')) return '';
    const { caseIds, models, skipped } = peFailedSelection(view);
    if (!caseIds.length) return '<span class="pe-muted">упавшие кейсы отключены</span>';
    const label = `${pePlural(caseIds.length, PE_CASE_FORMS)} × ${pePlural(models.length, PE_MODEL_FORMS)}`;
    const title = `Перезапустить: ${caseIds.join(', ')} на ${models.join(', ')}` + (skipped.length ? `. Пропущены отключённые: ${skipped.join(', ')}` : '');
    return `<button class="pe-btn ${compact ? 'pe-btn--small' : ''}" data-action="rerun-failed" data-run="${view.run.run_id}" title="${peEscape(title)}">
        <i data-lucide="rotate-ccw" class="w-4 h-4"></i> Перезапустить упавшие (${label})</button>`;
}

async function peRerunFailed(runId) {
    if (!peState.catalog) await peLoadCatalog();
    const view = peState.view && peState.view.run.run_id === runId ? peState.view : await peFetch(`/runs/${runId}/`);
    const { caseIds, models } = peFailedSelection(view);
    if (!caseIds.length) { peSetError('Нечего перезапускать: упавших включённых кейсов нет'); return; }
    const run = view.run;
    const started = await peFetch('/runs/start/', {
        method: 'POST',
        body: JSON.stringify({
            case_ids: caseIds,
            models,
            repeats: run.repeats || 1,
            judge: Boolean(run.judge_model),
            judge_model: run.judge_model || null,
            reason: `Перезапуск упавших из ${run.run_id}${run.reason ? `: ${run.reason}` : ''}`,
            jira_key: run.jira_key || null,
        }),
    });
    peState.openDetails.clear();
    peConnectRun(started.run_id);
    peSwitchTab('run');
}

function peRunHeader(view) {
    const run = view.run;
    const done = run.done_attempts;
    const percent = run.total_attempts ? Math.round((done / run.total_attempts) * 100) : 0;
    const started = new Date(run.created_at).getTime();
    const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
    const elapsed = end - started;
    const eta = view.live && done && done < run.total_attempts ? (elapsed / done) * (run.total_attempts - done) : null;
    return `
    <div class="pe-run-head">
        <div class="pe-run-head__top">
            ${peStatusPill(run.status)}
            <span class="pe-run-head__reason">${run.reason ? peEscape(run.reason) : '<span class="pe-muted">без описания</span>'}</span>
            ${run.jira_key ? `<a class="pe-chip" href="${PE_JIRA_URL}${peEscape(run.jira_key)}" target="_blank" rel="noopener">${peEscape(run.jira_key)}</a>` : ''}
            ${peIsRunActive() && view === peState.view ? `<button class="pe-btn pe-btn--danger" data-action="cancel" data-run="${run.run_id}"><i data-lucide="square" class="w-4 h-4"></i> Остановить</button>` : ''}
            ${peIsRunActive() ? '' : `<span class="pe-run-head__actions">${peRerunButton(view)}</span>`}
        </div>
        <div class="pe-progress"><div class="pe-progress__bar" style="width:${percent}%"></div></div>
        <div class="pe-run-head__stats">
            <span>${done} / ${run.total_attempts}</span>
            <span class="pe-count pe-count--passed">${run.passed}</span>
            <span class="pe-count pe-count--failed">${run.failed}</span>
            ${run.errors ? `<span class="pe-count pe-count--error">${run.errors} ошибок</span>` : ''}
            <span>${peFormatTokens(run.total_tokens)} токенов</span>
            <span>${peFormatDuration(elapsed)}${eta ? ` · осталось ~${peFormatDuration(eta)}` : ''}</span>
            <span class="pe-muted">${peEscape((run.models || []).join(', '))} · ×${run.repeats} · ${peEscape(run.triggered_by)} · ${peFormatDate(run.created_at)}${run.git_sha ? ` · ${peEscape(run.git_sha.slice(0, 8))}` : ''}</span>
        </div>
        ${run.error ? `<div class="pe-error-line">${peEscape(run.error)}</div>` : ''}
    </div>`;
}

function peAttemptDetails(result) {
    const failures = (result.failures || []).map(f =>
        `<li><b>${peEscape(f.key)}</b>: ожидалось ${peEscape(f.expected)}, получено ${peEscape(f.actual)}</li>`).join('');
    const judge = result.judge ? `
        <div class="pe-judge">judge: UI ${result.judge.ui_optimality} · содержание ${result.judge.content_informativeness} · следование ${result.judge.prompt_following}
            <div class="pe-muted">${peEscape(result.judge.reasoning)}</div></div>` : '';
    const output = result.output_json != null || result.id != null
        ? `<button class="pe-btn pe-btn--ghost pe-btn--small" data-action="show-output" data-result="${result.id ?? ''}" data-key="${peEscape(peAttemptKey(result))}">Показать ответ агента</button>
           <pre class="pe-output hidden" id="pe-output-${peEscape(peAttemptKey(result))}"></pre>` : '';
    return `
    <div class="pe-attempt">
        <div class="pe-attempt__head">${peEscape(result.model)} · попытка ${result.attempt} · ${peStatusPill(result.status)}
            <span class="pe-muted">${peFormatDuration(result.total_ms)} · ${peFormatTokens(result.total_tokens)} токенов${result.ui_items_count != null ? ` · ${result.ui_items_count} UI-элементов` : ''}</span></div>
        ${failures ? `<ul class="pe-failures">${failures}</ul>` : ''}
        ${result.error ? `<div class="pe-error-line">${peEscape(result.error)}</div>` : ''}
        ${judge}
        ${output}
    </div>`;
}

function peRenderCaseRow(view, testCase) {
    const results = view.results.filter(r => r.case_id === testCase.id);
    const models = view.run.models || [...new Set(results.map(r => r.model))];
    const repeats = view.run.repeats || 1;
    const status = peCaseStatus(results);
    const isRunning = Object.values(view.running).some(ref => ref.case_id === testCase.id);
    const open = peState.openDetails.has(`case:${testCase.id}`);
    const cells = models.map(model => {
        const dots = [];
        for (let attempt = 1; attempt <= repeats; attempt++) {
            const result = results.find(r => r.model === model && r.attempt === attempt);
            const running = view.running[`${testCase.id}|${model}|${attempt}`];
            const state = result ? result.status : running ? 'running' : 'pending';
            const title = result ? `${model} #${attempt}: ${result.status}` : running ? `${model} #${attempt}: ${running.step || 'старт'}` : `${model} #${attempt}: ждёт`;
            dots.push(`<span class="pe-dot pe-dot--${state}" title="${peEscape(title)}"></span>`);
        }
        const passed = results.filter(r => r.model === model && r.status === 'passed').length;
        const finished = results.filter(r => r.model === model).length;
        return `<div class="pe-cell" title="${peEscape(model)}"><span class="pe-cell__model">${peEscape(model)}</span>${dots.join('')}<span class="pe-muted">${finished ? `${passed}/${finished}` : ''}</span></div>`;
    }).join('');
    const runningSteps = Object.values(view.running).filter(ref => ref.case_id === testCase.id && ref.step).map(ref => ref.step);
    return `
    <div class="pe-case pe-case--${isRunning ? 'running' : status}">
        <button class="pe-case__head" data-action="toggle" data-key="case:${peEscape(testCase.id)}">
            ${isRunning ? '<span class="pe-spinner"></span>' : peStatusPill(results.length ? status : 'never')}
            <span class="pe-case__name">${peEscape(testCase.name)}</span>
            <span class="pe-muted">${peEscape(testCase.id)}</span>
            ${runningSteps.length ? `<span class="pe-step">${peEscape(runningSteps.join(', '))}</span>` : ''}
            <span class="pe-case__cells">${cells}</span>
        </button>
        ${open ? `
        <div class="pe-case__details">
            <div class="pe-case__desc">${peEscape(testCase.description)}</div>
            <div class="pe-muted">Запрос: «${peEscape(testCase.input)}» · ${peEscape(testCase.response_format)} · ${peEscape(testCase.stage)}</div>
            ${results.map(peAttemptDetails).join('') || '<div class="pe-muted">Результатов пока нет</div>'}
        </div>` : ''}
    </div>`;
}

function peGroupByPrompt(cases) {
    const groups = {};
    cases.forEach(c => { (groups[pePrimaryPrompt(c)] = groups[pePrimaryPrompt(c)] || []).push(c); });
    return groups;
}

function peCasesForView(view) {
    if (view.cases && view.cases.length) return view.cases;
    // Imported runs have no case snapshots: build minimal entries from results
    const ids = [...new Set(view.results.map(r => r.case_id))];
    return ids.map(id => ({ id, name: id, description: 'Описание недоступно (импортированный прогон)', prompts: ['неизвестный промпт'], input: '', response_format: '', stage: '' }));
}

async function peRenderRun() {
    if (!peState.catalog) await peLoadCatalog();
    if (!peState.view) {
        return '<div class="pe-empty">Нет активного прогона. Запустите его на вкладке «Запуск» или откройте из «Истории».</div>';
    }
    const view = peState.view;
    const groups = peGroupByPrompt(peCasesForView(view));
    return `
    ${peRunHeader(view)}
    <div class="pe-run-body">
        ${Object.entries(groups).map(([prompt, cases]) => `
        <div class="pe-group">
            ${pePromptTitle(prompt)}
            ${cases.map(c => peRenderCaseRow(view, c)).join('')}
        </div>`).join('')}
    </div>`;
}

async function peShowOutput(button) {
    const pre = document.getElementById(`pe-output-${button.dataset.key}`);
    if (!pre) return;
    if (!pre.classList.contains('hidden')) { pre.classList.add('hidden'); return; }
    const live = peState.view.results.find(r => peAttemptKey(r) === button.dataset.key);
    let output = live && live.output_json ? JSON.parse(live.output_json) : null;
    if (!output && button.dataset.result) output = (await peFetch(`/results/${button.dataset.result}/output/`)).output;
    pre.textContent = output ? JSON.stringify(output, null, 2) : 'Ответ не сохранён';
    pre.classList.remove('hidden');
}

// --- History ---

async function peRenderHistory() {
    if (!peState.catalog) await peLoadCatalog();
    await peLoadRuns();
    const prompts = [...new Set(peState.catalog.cases.flatMap(c => c.prompts))].sort();
    const usedModels = [...new Set(peState.runs.flatMap(r => r.models))].sort();
    const filter = peState.historyFilter;
    return `
    <div class="pe-history__toolbar">
        <select class="pe-input" data-action="filter-model"><option value="">Все модели</option>
            ${[...new Set([...usedModels, filter.model].filter(Boolean))].map(m => `<option ${m === filter.model ? 'selected' : ''}>${peEscape(m)}</option>`).join('')}</select>
        <select class="pe-input" data-action="filter-prompt"><option value="">Все промпты</option>
            ${prompts.map(p => `<option ${p === filter.prompt ? 'selected' : ''}>${peEscape(p)}</option>`).join('')}</select>
        <button class="pe-btn" data-action="compare" ${peState.selectedRuns.size < 1 ? 'disabled' : ''}>
            <i data-lucide="git-compare" class="w-4 h-4"></i> Сравнить (${peState.selectedRuns.size})</button>
    </div>
    ${peState.runs.length ? `
    <div class="pe-table-wrap"><table class="pe-table">
        <thead><tr><th></th><th>Когда</th><th>Зачем</th><th>Модели</th><th>Результат</th><th>Статус</th></tr></thead>
        <tbody>${peState.runs.map(run => {
            const total = run.done_attempts || 0;
            const passedShare = total ? (run.passed / total) * 100 : 0;
            return `
            <tr data-action="open-run" data-run="${run.run_id}">
                <td><input type="checkbox" data-action="select-run" data-run="${run.run_id}" ${peState.selectedRuns.has(run.run_id) ? 'checked' : ''}></td>
                <td class="pe-nowrap">${peFormatDate(run.created_at)}</td>
                <td>${peEscape(run.reason)} ${run.jira_key ? `<span class="pe-chip">${peEscape(run.jira_key)}</span>` : ''}
                    <div class="pe-muted">${peEscape(run.triggered_by)}${Object.keys(run.prompt_hashes).length ? '' : ' · версия промптов неизвестна'}</div></td>
                <td>${run.models.map(m => `<span class="pe-chip">${peEscape(m)}</span>`).join(' ')}${run.repeats > 1 ? ` ×${run.repeats}` : ''}</td>
                <td><div class="pe-mini-bar"><div style="width:${passedShare}%"></div></div>
                    <span class="pe-muted">${run.passed}/${total}</span></td>
                <td>${peStatusPill(run.status)}
                    ${run.failed + run.errors > 0 && !['queued', 'running'].includes(run.status) && !peIsRunActive()
                        ? `<button class="pe-icon-btn" data-action="rerun-failed" data-run="${run.run_id}" title="Перезапустить упавшие (${run.failed + run.errors} попыток)"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>` : ''}</td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>` : '<div class="pe-empty">Прогонов пока нет</div>'}`;
}

// --- Compare ---

async function peRenderCompare() {
    if (!peState.catalog) await peLoadCatalog();
    const runIds = [...peState.selectedRuns];
    if (!runIds.length) return '<div class="pe-empty">Отметьте прогоны во вкладке «История». Один прогон с несколькими моделями тоже можно сравнить.</div>';
    const details = await Promise.all(runIds.map(id => peFetch(`/runs/${id}/`)));
    const columns = details.flatMap(d => d.run.models.map(model => ({ run: d.run, model, results: d.results.filter(r => r.model === model) })));
    const casesById = {};
    details.forEach(d => peCasesForView({ cases: d.cases, results: d.results }).forEach(c => { casesById[c.id] = casesById[c.id] || c; }));
    const caseIds = Object.keys(casesById).filter(id => columns.some(col => col.results.some(r => r.case_id === id)));
    const groups = peGroupByPrompt(caseIds.map(id => casesById[id]));
    const promptsInView = new Set(caseIds.flatMap(id => casesById[id].prompts));
    const changed = [...promptsInView].filter(prompt => new Set(details.map(d => d.run.prompt_hashes[prompt] || '?')).size > 1);
    const unknown = details.some(d => !Object.keys(d.run.prompt_hashes).length);
    const summary = columns.map(col => {
        const judged = col.results.filter(r => r.judge).map(r => peJudgeMean(r.judge));
        const times = col.results.map(r => r.total_ms).filter(v => v != null);
        const tokens = col.results.map(r => r.total_tokens).filter(v => v != null);
        const passed = col.results.filter(r => r.status === 'passed').length;
        return {
            rate: col.results.length ? `${Math.round((passed / col.results.length) * 100)}%` : '—',
            judge: judged.length ? peMean(judged).toFixed(1) : '—',
            p50: peFormatDuration(peMedian(times)),
            tokens: tokens.length ? peFormatTokens(peMean(tokens)) : '—',
        };
    });
    const cell = (col, caseId) => {
        const results = col.results.filter(r => r.case_id === caseId);
        if (!results.length) return { html: '<td class="pe-muted">—</td>', key: '—' };
        const passed = results.filter(r => r.status === 'passed').length;
        const status = peAttemptsStatus(results.map(r => r.status));
        const share = passed / results.length;
        return { html: `<td><span class="pe-pill pe-pill--${status}">${passed}/${results.length}</span></td>`, key: share.toFixed(2) };
    };
    return `
    ${changed.length || unknown ? `<div class="pe-warning"><i data-lucide="alert-triangle" class="w-4 h-4"></i>
        ${changed.length ? `Версии промптов различаются: ${changed.map(peEscape).join(', ')}. Вы сравниваете не только модели, но и промпты.` : ''}
        ${unknown ? ' Есть прогоны с неизвестной версией промптов.' : ''}</div>` : ''}
    <div class="pe-table-wrap"><table class="pe-table pe-table--compare">
        <thead><tr><th>Кейс</th>${columns.map(col => `<th><div>${peEscape(col.model)}</div>
            <div class="pe-muted">${peFormatDate(col.run.created_at)} · ${peEscape(col.run.reason.slice(0, 40))}</div></th>`).join('')}</tr></thead>
        <tbody>
        ${Object.entries(groups).map(([prompt, cases]) => `
            <tr class="pe-table__group"><td colspan="${columns.length + 1}">${pePromptTitle(prompt)}</td></tr>
            ${cases.map(c => {
                const cells = columns.map(col => cell(col, c.id));
                const differs = new Set(cells.map(x => x.key).filter(k => k !== '—')).size > 1;
                const versions = new Set(details.map(d => d.cases.find(x => x.id === c.id)).filter(Boolean)
                    .map(x => JSON.stringify([x.input, x.response_format, x.stage, x.expect])));
                const changedCase = versions.size > 1 ? '<span class="pe-badge pe-badge--warn" title="Запрос или проверки кейса отличаются между прогонами">кейс менялся</span>' : '';
                return `<tr class="${differs ? 'pe-row--diff' : ''}"><td title="${peEscape(c.description)}">${peEscape(c.name)} <span class="pe-muted">${peEscape(c.id)}</span> ${changedCase}</td>${cells.map(x => x.html).join('')}</tr>`;
            }).join('')}`).join('')}
        <tr class="pe-table__summary"><td>Проходит</td>${summary.map(s => `<td>${s.rate}</td>`).join('')}</tr>
        <tr class="pe-table__summary"><td>Judge (среднее)</td>${summary.map(s => `<td>${s.judge}</td>`).join('')}</tr>
        <tr class="pe-table__summary"><td>Время p50</td>${summary.map(s => `<td>${s.p50}</td>`).join('')}</tr>
        <tr class="pe-table__summary"><td>Токенов на попытку</td>${summary.map(s => `<td>${s.tokens}</td>`).join('')}</tr>
        </tbody>
    </table></div>`;
}

// --- Events ---

async function peHandleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const launch = peState.launch;
    try {
        if (await peCasesClick(target, action)) return;
        if (action === 'tab') {
            peSwitchTab(target.dataset.tab);
        } else if (action === 'toggle') {
            const key = target.dataset.key;
            if (peState.openDetails.has(key)) peState.openDetails.delete(key); else peState.openDetails.add(key);
            peRenderBody();
        } else if (action === 'open-run') {
            if (e.target.closest('[data-action="select-run"]')) return;
            if (peState.view && peState.view.live && peState.view.run.run_id === target.dataset.run) { peSwitchTab('run'); return; }
            await peOpenStoredRun(target.dataset.run);
        } else if (action === 'prefill') {
            pePrefill(target.dataset.cases.split(','));
        } else if (action === 'toggle-chip') {
            const cases = peChipCases(target.dataset.kind, target.dataset.value);
            const select = peChipState(cases) !== 'on';
            cases.forEach(c => { if (select) launch.caseIds.add(c.id); else launch.caseIds.delete(c.id); });
            peRenderBody();
        } else if (action === 'rerun-overview') {
            await peRerunOverview(target.dataset.prompt || null);
        } else if (action === 'rerun-failed') {
            await peRerunFailed(target.dataset.run);
        } else if (action === 'remove-model') {
            launch.models.delete(target.dataset.model);
            peRenderBody();
        } else if (action === 'select-all') {
            peState.catalog.cases.forEach(c => launch.caseIds.add(c.id));
            peRenderBody();
        } else if (action === 'select-none') {
            launch.caseIds.clear();
            peRenderBody();
        } else if (action === 'cancel') {
            await peFetch(`/runs/${target.dataset.run}/cancel/`, { method: 'POST' });
        } else if (action === 'show-output') {
            await peShowOutput(target);
        } else if (action === 'compare') {
            peSwitchTab('compare');
        } else if (action === 'refresh') {
            peState.overview = null;
            peState.catalog = null;
            peRenderBody();
        }
    } catch (error) {
        peSetError(error);
    }
}

function peHandleChange(e) {
    const target = e.target;
    const action = target.dataset.action;
    if (peCasesChange(target, action)) return;
    const launch = peState.launch;
    if (action === 'toggle-case') {
        if (target.checked) launch.caseIds.add(target.dataset.case); else launch.caseIds.delete(target.dataset.case);
    } else if (action === 'toggle-suite') {
        peState.catalog.cases.filter(c => c.suite === target.dataset.suite)
            .forEach(c => { if (target.checked) launch.caseIds.add(c.id); else launch.caseIds.delete(c.id); });
    } else if (action === 'toggle-model') {
        if (target.checked) launch.models.add(target.dataset.model); else launch.models.delete(target.dataset.model);
    } else if (action === 'repeats') {
        launch.repeats = Math.min(10, Math.max(1, parseInt(target.value, 10) || 1));
    } else if (action === 'judge') {
        launch.judge = target.checked;
    } else if (action === 'judge-model') {
        launch.judgeModel = target.value;
        return;
    } else if (action === 'select-run') {
        if (target.checked) peState.selectedRuns.add(target.dataset.run); else peState.selectedRuns.delete(target.dataset.run);
        const button = document.querySelector('#pe-body [data-action="compare"]');
        if (button) {
            button.disabled = peState.selectedRuns.size < 1;
            button.lastChild.textContent = ` Сравнить (${peState.selectedRuns.size})`;
        }
        return;
    } else if (action === 'filter-model' || action === 'filter-prompt') {
        peState.historyFilter[action === 'filter-model' ? 'model' : 'prompt'] = target.value;
    } else {
        return;
    }
    peRenderBody();
}

function peHandleInput(e) {
    const target = e.target;
    const action = target.dataset.action;
    if (peCasesInput(target, action)) return;
    if (action === 'reason') peState.launch.reason = target.value;
    else if (action === 'jira') peState.launch.jira = target.value;
    else if (action === 'model-filter') {
        peState.launch.modelFilter = target.value;
        const position = target.selectionStart;
        peRenderBody().then(() => {
            const input = document.querySelector('#pe-body [data-action="model-filter"]');
            if (input) { input.focus(); input.setSelectionRange(position, position); }
        });
    }
}

function initPromptEvals() {
    const root = document.getElementById('prompts-root');
    if (!root) return;
    root.innerHTML = `
        <div class="pe__header">
            <div class="pe__title"><i data-lucide="flask-conical" class="w-5 h-5"></i> Промпты
                <span id="pe-live-badge" class="pe-badge pe-badge--live hidden"></span>
                <button class="pe-icon-btn" data-action="refresh" title="Обновить"><i data-lucide="refresh-cw" class="w-4 h-4"></i></button>
            </div>
            <div class="pe__tabs">${PE_TABS.map(tab => `
                <button class="pe-tab ${tab.id === peState.tab ? 'pe-tab--active' : ''}" data-action="tab" data-tab="${tab.id}">
                    <i data-lucide="${tab.icon}" class="w-4 h-4"></i> ${tab.label}</button>`).join('')}</div>
        </div>
        <div id="pe-error" class="pe-error hidden"></div>
        <div id="pe-body" class="pe__body"></div>`;
    lucide.createIcons({ nodes: [root] });
    root.addEventListener('click', peHandleClick);
    root.addEventListener('change', peHandleChange);
    root.addEventListener('input', peHandleInput);
    root.addEventListener('submit', (e) => {
        e.preventDefault();
        if (e.target.dataset.form === 'case') peSaveCase(false);
        else peStartRun().catch(peSetError);
    });
    // Elapsed time and ETA tick while a run is live
    setInterval(() => {
        if (peState.active && peState.tab === 'run' && peIsRunActive()) peRenderBody();
    }, 5000);
}

// --- View switching (same pattern as showSwarmView) ---

function showPromptsView() {
    ['chat-view', 'dashboard-view', 'widget-view', 'voice-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hideMonitoringView === 'function') window.hideMonitoringView();
    document.getElementById('prompts-view').classList.remove('hidden');
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    if (typeof stopDashboardPolling === 'function') stopDashboardPolling();
    document.getElementById('left-sidebar').classList.add('hidden');
    updateSidebarActiveState('prompts');
    peState.active = true;
    peState.overview = null;
    peRenderBody();
    if (!peState.ws) peAttachActiveRun().catch(peSetError);
}

function hidePromptsView() {
    const view = document.getElementById('prompts-view');
    if (view) view.classList.add('hidden');
    peState.active = false;
}

window.showPromptsView = showPromptsView;
window.hidePromptsView = hidePromptsView;

document.addEventListener('DOMContentLoaded', initPromptEvals);
