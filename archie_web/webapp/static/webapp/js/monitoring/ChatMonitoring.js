// Chat monitoring (ARCHIE-213): an LLM judge grades assistant turns red/orange/green.
// Data: Django /chat-monitoring/api/. A run is started on the agent; the agent
// reports each judged turn to Django, the UI polls the run state.
// Protocol: archie_shared.monitoring.models (MonitorRunInfo, MonitorTurnEvaluation).

const CM_API = '/chat-monitoring/api';
const CM_POLL_MS = 2000;
const CM_GRADES = ['red', 'orange', 'green'];
const CM_GRADE_LABELS = { red: 'Плохо', orange: 'Есть замечания', green: 'Хорошо', pending: 'Не оценено' };
const CM_CRITERIA_LABELS = {
    helpfulness: 'Полезность',
    correctness: 'Корректность',
    tool_choice: 'Инструменты',
    skill_usage: 'Скиллы',
    format_fit: 'Формат',
};
// Fixed reason codes (archie_shared MonitorReason) picked by the Jev judge
const CM_REASON_LABELS = {
    helpless_refusal: 'Беспомощный отказ',
    needless_question: 'Лишний уточняющий вопрос',
    off_topic: 'Ответ не на тот вопрос',
    partial_answer: 'Ответил не на всё',
    ignored_context: 'Не учёл контекст беседы',
    wrong_language: 'Не тот язык',
    factual_error: 'Фактическая ошибка',
    invented_data: 'Выдуманные данные',
    realtime_without_search: 'Актуальные данные без поиска',
    leaked_error: 'Ошибка видна пользователю',
    contradiction: 'Противоречие',
    wrong_action: 'Не то действие',
    missing_tool: 'Не вызван нужный инструмент',
    wrong_tool: 'Не тот инструмент',
    bad_arguments: 'Неверные аргументы',
    extra_tool: 'Лишний вызов',
    tool_error_ignored: 'Ошибка инструмента скрыта',
    skill_not_loaded: 'Скилл не загружен',
    wrong_skill: 'Не тот скилл',
    skill_not_followed: 'Скилл не соблюдён',
    broken_ui: 'Сломанный UI',
    empty_response: 'Пустой ответ',
    wrong_element: 'Не тот UI-элемент',
    missing_quick_actions: 'Нет быстрых действий',
    too_long: 'Слишком длинно',
    wrong_format: 'Не тот формат',
    rephrased_request: 'Пользователь повторил запрос',
    user_correction: 'Пользователь указал на ошибку',
};
// The API judges at most 200 conversations per run, so 200 means «all pending»
const CM_RUN_ALL = 200;
const CM_RUN_SIZES = [10, 20, 50, 100, CM_RUN_ALL];
// Prompt specs a turn is judged against (agent app/monitoring/spec_rules.py)
const CM_SPEC_LABELS = { outcome: 'Результат', goal: 'Цель запроса', cmd_prompt: 'Stage 1 · инструменты', assistant_prompt: 'Общие правила' };
const CM_RULE_GRADE_ORDER = { red: 0, orange: 1, green: 2 };
const CM_LABEL_CHARS = 70;
const CM_PAGE_WINDOW = 2;
const CM_TEXT_PREVIEW = 600;

const cmState = {
    active: false,
    summary: null,
    conversations: [],
    page: 1,
    pages: 1,
    total: 0,
    filter: { grade: '', unreviewed: false, reason: '' },
    open: new Map(),      // conversation_id -> detail (null while loading)
    expandedText: new Set(),
    expandedRules: new Set(),   // message ids with all rules shown
    run: null,
    runSize: 20,
    pollTimer: null,
    error: null,
};

// --- Helpers (shared formatting lives in PromptEvals.js: peEscape, peFormatDate, pePlural) ---

async function cmFetch(path, options = {}) {
    const response = await fetch(`${CM_API}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken'), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

function cmSetError(error) {
    cmState.error = error ? String(error.message || error) : null;
    cmRender();
}

function cmGradeDot(grade) {
    return grade
        ? `<span class="cm-dot cm-dot--${grade}" title="${CM_GRADE_LABELS[grade]}"></span>`
        : '<span class="cm-dot cm-dot--na" title="Не применимо"></span>';
}

const CM_TURN_FORMS = ['реплика', 'реплики', 'реплик'];
const CM_RULE_FORMS = ['правило', 'правила', 'правил'];
const CM_CONVERSATION_FORMS = ['беседа', 'беседы', 'бесед'];

// --- Data ---

async function cmLoadSummary() {
    cmState.summary = await cmFetch('/summary/');
}

async function cmLoadConversations(page = 1) {
    const params = new URLSearchParams({ page });
    if (cmState.filter.grade) params.set('grade', cmState.filter.grade);
    if (cmState.filter.reason) params.set('reason', cmState.filter.reason);
    if (cmState.filter.unreviewed) params.set('unreviewed', '1');
    const data = await cmFetch(`/conversations/?${params}`);
    cmState.conversations = data.conversations;
    cmState.page = data.page;
    cmState.pages = data.pages;
    cmState.total = data.total;
}

async function cmRefresh() {
    try {
        // Stay on the current page; opened details are stale after a run
        cmState.open.clear();
        await Promise.all([cmLoadSummary(), cmLoadConversations(cmState.page)]);
        cmState.error = null;
    } catch (error) {
        cmState.error = error.message;
    }
    cmRender();
}

async function cmToggleConversation(conversationId) {
    if (cmState.open.has(conversationId)) {
        cmState.open.delete(conversationId);
        cmRender();
        return;
    }
    cmState.open.set(conversationId, null);
    cmRender();
    try {
        cmState.open.set(conversationId, await cmFetch(`/conversations/${encodeURIComponent(conversationId)}/`));
    } catch (error) {
        cmState.open.delete(conversationId);
        cmState.error = error.message;
    }
    cmRender();
}

async function cmMarkReviewed(conversationId) {
    try {
        await cmFetch(`/conversations/${encodeURIComponent(conversationId)}/review/`, { method: 'POST' });
        cmState.open.delete(conversationId);
        await cmRefresh();
    } catch (error) {
        cmSetError(error);
    }
}

// --- Runs ---

// conversationId set: judge only that conversation's pending turns
async function cmStartRun(conversationId = null) {
    const body = conversationId
        ? { conversation_ids: [conversationId], max_conversations: 1 }
        : { max_conversations: cmState.runSize };
    try {
        cmState.run = await cmFetch('/runs/start/', { method: 'POST', body: JSON.stringify(body) });
        cmState.error = null;
        cmRender();
        cmPollRun();
    } catch (error) {
        cmSetError(error);
    }
}

function cmPollRun() {
    clearTimeout(cmState.pollTimer);
    cmState.pollTimer = setTimeout(async () => {
        if (!cmState.active || !cmState.run) return;
        try {
            cmState.run = await cmFetch(`/runs/${cmState.run.run_id}/`);
        } catch (error) {
            // The first run update may not be stored yet; keep polling
            console.warn('[Monitoring] run poll failed', error);
        }
        if (cmState.run.status === 'running') {
            cmRender();
            cmPollRun();
            return;
        }
        await cmRefresh();
    }, CM_POLL_MS);
}

async function cmAttachActiveRun() {
    // No active run: show the last one (it may have finished while the view was hidden)
    const { run } = await cmFetch('/runs/active/');
    cmState.run = run || (cmState.summary && cmState.summary.runs[0]) || null;
    cmRender();
    if (run) cmPollRun();
}

// --- Rendering ---

function cmRenderHeader() {
    return `
        <div class="pe__header">
            <div class="pe__title"><i data-lucide="shield-check" class="w-5 h-5"></i> Мониторинг чатов</div>
            <div class="pe-muted">Судья (TypeSafe Jev) проверяет каждый ответ Archie по правилам спецификаций его промптов.</div>
        </div>`;
}

function cmRenderSummary() {
    const summary = cmState.summary;
    if (!summary) return '';
    const tiles = CM_GRADES.map(grade => `
        <button class="cm-stat cm-stat--${grade} ${cmState.filter.grade === grade ? 'cm-stat--on' : ''}" data-cm-grade="${grade}">
            <span class="cm-stat__value">${summary.conversations[grade] || 0}</span>
            <span class="cm-stat__label">${cmGradeDot(grade)} ${CM_GRADE_LABELS[grade]}</span>
            <span class="pe-muted">${pePlural(summary.turns[grade] || 0, CM_TURN_FORMS)}</span>
        </button>`).join('');
    return `<div class="cm-stats">${tiles}${cmRenderRunBox()}</div>${cmRenderReasons()}`;
}

function cmSpecLabel(spec) {
    return CM_SPEC_LABELS[spec] || spec.replace(/^format_/, 'формат ');
}

function cmShorten(text, chars) {
    const line = (text || '').split('\n')[0].replace(/\*\*/g, '');
    return line.length > chars ? `${line.slice(0, chars)}…` : line;
}

// A reason is a broken rule key 'spec:rule_id' or an older criterion reason code
function cmReasonLabel(code) {
    const text = cmState.summary && (cmState.summary.reason_labels || {})[code];
    if (text) return `${cmSpecLabel(code.split(':')[0])}: ${cmShorten(text, CM_LABEL_CHARS)}`;
    return CM_REASON_LABELS[code] || code;
}

function cmRenderReasons() {
    const reasons = Object.entries(cmState.summary.reasons || {});
    if (!reasons.length) return '';
    const chips = reasons.map(([code, count]) => `
        <button class="pe-chip pe-chip--btn ${cmState.filter.reason === code ? 'pe-chip--on' : ''}" data-cm-reason="${peEscape(code)}"
            title="${peEscape((cmState.summary.reason_labels || {})[code] || code)}">
            ${peEscape(cmReasonLabel(code))} <span class="cm-reason__count">${count}</span></button>`).join('');
    return `<div class="cm-reasons"><span class="pe-muted">Частые нарушения:</span> ${chips}</div>`;
}

function cmRenderRunBox() {
    const run = cmState.run;
    if (run && run.status === 'running') {
        const percent = run.total_turns ? Math.round((run.done_turns / run.total_turns) * 100) : 0;
        return `
            <div class="cm-run">
                <div class="cm-run__title"><span class="pe-badge pe-badge--live">идёт оценка</span>
                    ${run.done_turns} / ${pePlural(run.total_turns, CM_TURN_FORMS)}</div>
                <div class="cm-progress"><div class="cm-progress__bar" style="width:${percent}%"></div></div>
                <div class="pe-muted">${cmGradeDot('red')} ${run.red} ${cmGradeDot('orange')} ${run.orange} ${cmGradeDot('green')} ${run.green}
                    ${run.errors ? ` · ошибок: ${run.errors}` : ''} · $${(run.total_cost || 0).toFixed(4)} · ${peEscape(run.judge_model)}</div>
            </div>`;
    }
    const summary = cmState.summary;
    const options = CM_RUN_SIZES.map(size =>
        `<option value="${size}" ${size === cmState.runSize ? 'selected' : ''}>${size === CM_RUN_ALL ? 'все' : size}</option>`).join('');
    const last = run && run.status !== 'running'
        ? `<div class="pe-muted">Последний прогон: ${peFormatDate(run.finished_at || run.created_at)} · ${run.done_turns} оценено
            ${run.errors ? `· ошибок: ${run.errors}` : ''} · $${(run.total_cost || 0).toFixed(4)}${run.error ? ` · ${peEscape(run.error)}` : ''}</div>`
        : '';
    return `
        <div class="cm-run">
            <div class="cm-run__title">Не оценено: ${pePlural(summary.pending_turns, CM_TURN_FORMS)}
                · ${pePlural(summary.pending_conversations, CM_CONVERSATION_FORMS)}</div>
            <div class="cm-run__actions">
                <label class="pe-muted">до <select id="cm-run-size" class="cm-select">${options}</select> бесед</label>
                <button class="pe-btn" id="cm-run-start" ${summary.pending_turns ? '' : 'disabled'}>
                    <i data-lucide="play" class="w-4 h-4"></i> Оценить</button>
            </div>
            ${last}
        </div>`;
}

function cmRenderFilters() {
    const chips = [['', 'Все'], ...[...CM_GRADES, 'pending'].map(grade => [grade, CM_GRADE_LABELS[grade]])].map(([grade, label]) =>
        `<button class="pe-chip pe-chip--btn ${cmState.filter.grade === grade ? 'pe-chip--on' : ''}" data-cm-grade="${grade}">${label}</button>`).join('');
    return `
        <div class="cm-filters">
            ${chips}
            <label class="cm-check"><input type="checkbox" id="cm-unreviewed" ${cmState.filter.unreviewed ? 'checked' : ''}> только непросмотренные</label>
        </div>`;
}

function cmRenderToolCalls(evaluation) {
    if (!evaluation.trace_found) return '<span class="pe-muted">трейс Langfuse не найден — инструменты не оценивались</span>';
    if (!evaluation.tool_calls.length) return '<span class="pe-muted">инструменты не вызывались</span>';
    return evaluation.tool_calls.map(call => {
        const mark = call.success === false ? ' ✗' : call.success === true ? ' ✓' : '';
        return `<span class="pe-chip ${call.success === false ? 'cm-chip--failed' : ''}" title="${peEscape(call.arguments)}">${peEscape(call.name)}${mark}</span>`;
    }).join(' ');
}

// Free-text summary from older LLM-judged turns; Jev turns list their reasons
function cmBrokenRules(evaluation) {
    return (evaluation.rules || [])
        .filter(rule => rule.grade === 'red' || rule.grade === 'orange')
        .sort((a, b) => CM_RULE_GRADE_ORDER[a.grade] - CM_RULE_GRADE_ORDER[b.grade]);
}

function cmEvaluationSummary(evaluation) {
    if (evaluation.summary) return evaluation.summary;
    if ((evaluation.rules || []).length) {
        const broken = cmBrokenRules(evaluation);
        return broken.length
            ? `Нарушено ${pePlural(broken.length, CM_RULE_FORMS)} из ${(evaluation.rules || []).filter(r => r.grade).length} применимых`
            : 'Все применимые правила соблюдены';
    }
    const reasons = evaluation.criteria.filter(item => item.reason).map(item => cmReasonLabel(item.reason));
    return reasons.length ? reasons.join(' · ') : CM_GRADE_LABELS[evaluation.grade];
}

function cmRenderRule(rule) {
    return `
        <div class="cm-rule" title="${peEscape(rule.spec)}:${peEscape(rule.rule_id)}${rule.probability != null ? ` · p=${rule.probability}` : ''}">
            ${cmGradeDot(rule.grade)}
            <span class="cm-rule__text">${peEscape(cmShorten(rule.text, 220))}${rule.reason
                ? ` <span class="cm-rule__reason">— ${peEscape(cmReasonLabel(rule.reason))}</span>` : ''}</span>
        </div>`;
}

// Rules grouped by spec: broken first; followed / not applicable on demand
function cmRenderRules(evaluation, messageId) {
    const rules = evaluation.rules || [];
    if (!rules.length) return '';
    const showAll = cmState.expandedRules.has(messageId);
    const specs = [...new Set(rules.map(rule => rule.spec))];
    const groups = specs.map(spec => {
        const ofSpec = rules.filter(rule => rule.spec === spec);
        const shown = showAll ? ofSpec : ofSpec.filter(rule => rule.grade === 'red' || rule.grade === 'orange');
        if (!shown.length) return '';
        const ordered = [...shown].sort((a, b) =>
            (CM_RULE_GRADE_ORDER[a.grade] ?? 3) - (CM_RULE_GRADE_ORDER[b.grade] ?? 3));
        return `<div class="cm-rules__spec">${peEscape(cmSpecLabel(spec))}</div>${ordered.map(cmRenderRule).join('')}`;
    }).join('');
    const followed = rules.filter(rule => rule.grade === 'green').length;
    const notApplicable = rules.filter(rule => !rule.grade).length;
    return `
        <div class="cm-rules">${groups}
            <button class="cm-link" data-cm-rules="${peEscape(messageId)}">${showAll
                ? 'скрыть соблюдённые'
                : `соблюдено ${followed} · не относится ${notApplicable} — показать все`}</button>
        </div>`;
}

function cmRenderEvaluation(evaluation, messageId) {
    const criteria = evaluation.criteria.map(item => `
        <div class="cm-criterion">
            ${cmGradeDot(item.grade)}
            <span class="cm-criterion__name">${CM_CRITERIA_LABELS[item.criterion] || peEscape(item.criterion)}</span>
            <span class="cm-criterion__comment">${item.grade === null ? '<span class="pe-muted">не применимо</span>'
                : peEscape(item.reason ? cmReasonLabel(item.reason) : (item.comment || (item.grade === 'green' ? '' : '—')))}</span>
        </div>`).join('');
    const skills = evaluation.skills_loaded.length
        ? `<div class="cm-eval__row"><span class="pe-muted">Скиллы:</span> ${evaluation.skills_loaded.map(name => `<span class="pe-chip">${peEscape(name)}</span>`).join(' ')}</div>`
        : '';
    const cost = evaluation.judge_cost != null ? ` · $${evaluation.judge_cost.toFixed(5)}` : '';
    return `
        <div class="cm-eval cm-eval--${evaluation.grade}">
            <div class="cm-eval__summary">${cmGradeDot(evaluation.grade)} ${peEscape(cmEvaluationSummary(evaluation))}</div>
            ${criteria ? `<div class="cm-criteria">${criteria}</div>` : ''}
            ${cmRenderRules(evaluation, messageId)}
            <div class="cm-eval__row"><span class="pe-muted">Инструменты:</span> ${cmRenderToolCalls(evaluation)}</div>
            ${skills}
            <div class="pe-muted">${peEscape(evaluation.judge_model)} · ${peFormatDate(evaluation.evaluated_at)}${cost}
                ${evaluation.reviewed_at ? ` · просмотрено ${peEscape(evaluation.reviewed_by)}` : ''}</div>
        </div>`;
}

function cmRenderMessage(message) {
    const text = message.text || `[${message.content_format}]`;
    const expanded = cmState.expandedText.has(message.message_id);
    const shown = expanded || text.length <= CM_TEXT_PREVIEW ? text : `${text.slice(0, CM_TEXT_PREVIEW)}…`;
    const more = text.length > CM_TEXT_PREVIEW
        ? `<button class="cm-link" data-cm-text="${peEscape(message.message_id)}">${expanded ? 'свернуть' : 'показать полностью'}</button>`
        : '';
    const role = message.role === 'user' ? 'Пользователь' : `Archie · ${peEscape(message.content_format)}`;
    return `
        <div class="cm-msg cm-msg--${message.role}">
            <div class="cm-msg__meta">${role} · ${peFormatDate(message.created_at)}</div>
            <div class="cm-msg__text">${peEscape(shown)}</div>${more}
            ${message.evaluation ? cmRenderEvaluation(message.evaluation, message.message_id) : (message.role === 'assistant' ? '<div class="pe-muted">не оценено</div>' : '')}
        </div>`;
}

function cmRenderConversation(conversation) {
    const id = conversation.conversation_id;
    const isOpen = cmState.open.has(id);
    const detail = cmState.open.get(id);
    const counts = CM_GRADES.filter(grade => conversation[grade])
        .map(grade => `<span class="cm-count cm-count--${grade}" title="${CM_GRADE_LABELS[grade]}">${conversation[grade]}</span>`).join('');
    const pending = conversation.pending
        ? `<span class="cm-count cm-count--pending" title="Не оценено">${conversation.pending}</span>` : '';
    const evaluated = conversation.last_evaluated_at
        ? `оценено ${peFormatDate(conversation.last_evaluated_at)}` : 'не оценено';
    const running = cmState.run && cmState.run.status === 'running';
    const judge = conversation.pending
        ? `<button class="pe-btn pe-btn--small cm-conv__judge" data-cm-judge="${peEscape(id)}" ${running ? 'disabled' : ''}
              title="Оценить ${pePlural(conversation.pending, CM_TURN_FORMS)} этой беседы"><i data-lucide="play" class="w-4 h-4"></i> Оценить</button>`
        : '';
    let body = '';
    if (isOpen) {
        body = detail
            ? `<div class="cm-thread">${detail.messages.map(cmRenderMessage).join('')}
                ${conversation.unreviewed ? `<button class="pe-btn pe-btn--small" data-cm-review="${peEscape(id)}">
                    <i data-lucide="check" class="w-4 h-4"></i> Отметить просмотренным</button>` : ''}</div>`
            : '<div class="pe-muted cm-thread">Загрузка…</div>';
    }
    return `
        <div class="pe-prompt cm-conv cm-conv--${conversation.grade}">
            <div class="cm-conv__row">
                <button class="pe-prompt__head" data-cm-open="${peEscape(id)}">
                    ${cmGradeDot(conversation.grade)}
                    <span class="pe-prompt__title">
                        <span class="cm-conv__title">${peEscape(conversation.title)}</span>
                        <span class="pe-prompt__desc">${peFormatDate(conversation.last_message_at)} · ${evaluated}</span>
                    </span>
                    <span class="pe-prompt__counts">${counts}${pending}
                        ${conversation.unreviewed ? '<span class="pe-badge pe-badge--warn">новое</span>' : ''}</span>
                    <i data-lucide="${isOpen ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4"></i>
                </button>
                ${judge}
            </div>
            ${body}
        </div>`;
}

function cmRenderPagination() {
    if (cmState.pages <= 1) return '';
    const pages = new Set([1, cmState.pages]);
    for (let page = cmState.page - CM_PAGE_WINDOW; page <= cmState.page + CM_PAGE_WINDOW; page += 1) {
        if (page >= 1 && page <= cmState.pages) pages.add(page);
    }
    let previous = 0;
    const items = [...pages].sort((a, b) => a - b).map(page => {
        const gap = page - previous > 1 ? '<span class="pe-muted">…</span>' : '';
        previous = page;
        return `${gap}<button class="cm-page ${page === cmState.page ? 'cm-page--on' : ''}" data-cm-page="${page}">${page}</button>`;
    }).join('');
    return `
        <div class="cm-pagination">
            <button class="cm-page" data-cm-page="${cmState.page - 1}" ${cmState.page === 1 ? 'disabled' : ''}>‹</button>
            ${items}
            <button class="cm-page" data-cm-page="${cmState.page + 1}" ${cmState.page === cmState.pages ? 'disabled' : ''}>›</button>
            <span class="pe-muted">${pePlural(cmState.total, CM_CONVERSATION_FORMS)}</span>
        </div>`;
}

function cmRenderList() {
    if (!cmState.conversations.length) {
        return '<div class="pe-empty">Нет бесед под этот фильтр.</div>';
    }
    return `
        <div class="pe-overview">${cmState.conversations.map(cmRenderConversation).join('')}</div>
        ${cmRenderPagination()}`;
}

function cmRender() {
    const root = document.getElementById('monitoring-root');
    if (!root || !cmState.active) return;
    const error = cmState.error
        ? `<div class="pe-warning"><i data-lucide="alert-triangle" class="w-4 h-4"></i> ${peEscape(cmState.error)}</div>`
        : '';
    root.innerHTML = `
        ${cmRenderHeader()}
        <div class="pe__body">
            ${error}
            ${cmRenderSummary()}
            ${cmRenderFilters()}
            ${cmRenderList()}
        </div>`;
    lucide.createIcons({ nodes: [root] });
}

// --- Events (delegated, bound once) ---

function cmHandleClick(event) {
    const target = event.target.closest('button, [data-cm-grade], [data-cm-reason]');
    if (!target) return;
    if (target.id === 'cm-run-start') cmStartRun();
    else if (target.dataset.cmPage) {
        cmState.open.clear();
        cmLoadConversations(Number(target.dataset.cmPage)).then(() => {
            cmRender();
            document.querySelector('#monitoring-root .pe__body').scrollTop = 0;
        }).catch(cmSetError);
    } else if (target.dataset.cmJudge) cmStartRun(target.dataset.cmJudge); else if (target.dataset.cmReason) {
        const reason = target.dataset.cmReason;
        cmState.filter.reason = cmState.filter.reason === reason ? '' : reason;
        cmLoadConversations().then(cmRender).catch(cmSetError);
    } else if (target.dataset.cmGrade !== undefined) {
        const grade = target.dataset.cmGrade;
        cmState.filter.grade = cmState.filter.grade === grade ? '' : grade;
        cmLoadConversations().then(cmRender).catch(cmSetError);
    } else if (target.dataset.cmOpen) cmToggleConversation(target.dataset.cmOpen);
    else if (target.dataset.cmReview) cmMarkReviewed(target.dataset.cmReview);
    else if (target.dataset.cmRules) {
        const id = target.dataset.cmRules;
        if (cmState.expandedRules.has(id)) cmState.expandedRules.delete(id);
        else cmState.expandedRules.add(id);
        cmRender();
    } else if (target.dataset.cmText) {
        const id = target.dataset.cmText;
        if (cmState.expandedText.has(id)) cmState.expandedText.delete(id);
        else cmState.expandedText.add(id);
        cmRender();
    }
}

function cmHandleChange(event) {
    if (event.target.id === 'cm-unreviewed') {
        cmState.filter.unreviewed = event.target.checked;
        cmLoadConversations().then(cmRender).catch(cmSetError);
    } else if (event.target.id === 'cm-run-size') {
        cmState.runSize = Number(event.target.value);
    }
}

function initChatMonitoring() {
    const root = document.getElementById('monitoring-root');
    if (!root) return;
    root.addEventListener('click', cmHandleClick);
    root.addEventListener('change', cmHandleChange);
}

// --- View switching (same pattern as showPromptsView) ---

function showMonitoringView() {
    ['chat-view', 'dashboard-view', 'widget-view', 'voice-view'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    if (typeof window.hideSwarmView === 'function') window.hideSwarmView();
    if (typeof window.hidePromptsView === 'function') window.hidePromptsView();
    document.getElementById('monitoring-view').classList.remove('hidden');
    document.body.classList.remove('voice-mode');
    if (typeof window.stopVoiceSession === 'function') window.stopVoiceSession();
    if (typeof stopDashboardPolling === 'function') stopDashboardPolling();
    document.getElementById('left-sidebar').classList.add('hidden');
    updateSidebarActiveState('monitoring');
    cmState.active = true;
    cmRender();
    cmRefresh().then(() => cmAttachActiveRun()).catch(cmSetError);
}

function hideMonitoringView() {
    const view = document.getElementById('monitoring-view');
    if (view) view.classList.add('hidden');
    cmState.active = false;
    clearTimeout(cmState.pollTimer);
}

window.showMonitoringView = showMonitoringView;
window.hideMonitoringView = hideMonitoringView;

document.addEventListener('DOMContentLoaded', initChatMonitoring);
