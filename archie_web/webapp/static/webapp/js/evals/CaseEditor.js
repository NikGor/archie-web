// Prompt test suite (ARCHIE-208): "Кейсы" tab — list, create, edit, duplicate,
// disable eval cases and browse their revisions. Cases live in Django; the agent
// validates every save (POST /prompt-evals/api/cases/ -> agent /evals/cases/validate).
// Uses peState, peFetch, peEscape and other helpers from PromptEvals.js.

const PE_EXPECT_FIELDS = {
    stage1: ['action_type', 'tools_called'],
    full: ['content_not_empty', 'max_total_tokens', 'max_latency_ms', 'text_contains', 'rules_followed'],
    ui_answer: ['min_ui_items', 'has_quick_actions', 'has_form', 'expected_item_types'],
};

const peCases = {
    list: null,
    schema: null,
    filter: '',
    showDisabled: false,
    editor: null,   // {mode: 'create'|'edit', draft, revision, error, revisions, saving}
    runModel: '',   // model for "Сохранить и прогнать"; default model if empty
};

function peEmptyDraft(suite = '') {
    return {
        id: suite ? `${suite}.` : '', name: '', description: '', suite, extra_prompts: [], tags: [], rules: [],
        input: '', response_format: 'ui_answer', stage: 'full', judge: false,
        expect: { content_not_empty: true },
    };
}

function peDraftFromCase(testCase) {
    const draft = {};
    const listFields = ['extra_prompts', 'tags', 'rules'];
    ['id', 'name', 'description', 'suite', 'extra_prompts', 'tags', 'rules', 'input', 'response_format', 'stage', 'judge']
        .forEach(key => { draft[key] = JSON.parse(JSON.stringify(testCase[key] ?? (listFields.includes(key) ? [] : ''))); });
    draft.expect = JSON.parse(JSON.stringify(testCase.expect || {}));
    return draft;
}

// Keep only the expect fields that apply to the stage/format, drop empty values.
function peCleanDraft(draft) {
    const allowed = new Set(draft.stage === 'stage1' ? PE_EXPECT_FIELDS.stage1
        : [...PE_EXPECT_FIELDS.full, ...(draft.response_format === 'ui_answer' ? PE_EXPECT_FIELDS.ui_answer : [])]);
    const expect = {};
    Object.entries(draft.expect).forEach(([key, value]) => {
        if (!allowed.has(key) || value === '' || value === null || value === false) return;
        if (Array.isArray(value) && !value.length) return;
        expect[key] = value;
    });
    return {
        ...draft,
        id: draft.id.trim(), name: draft.name.trim(), description: draft.description.trim(), suite: draft.suite.trim(),
        judge: draft.stage === 'full' && draft.response_format === 'ui_answer' ? draft.judge : false,
        expect,
    };
}

async function peLoadCases() {
    const [cases, schema] = await Promise.all([
        peFetch('/cases/?include_disabled=1'),
        peCases.schema ? Promise.resolve(peCases.schema) : peFetch('/schema/'),
    ]);
    peCases.list = cases.cases;
    peCases.schema = schema;
}

function peInvalidateCatalog() {
    peCases.list = null;
    peState.catalog = null;
    peState.overview = null;
}

// --- List ---

function peCaseMatches(testCase) {
    const query = peCases.filter.trim().toLowerCase();
    if (!query) return true;
    return [testCase.id, testCase.name, testCase.description, testCase.input, ...testCase.tags, ...testCase.prompts, ...(testCase.rules || [])]
        .some(value => value.toLowerCase().includes(query));
}

function peRenderCaseList() {
    const visible = peCases.list.filter(c => (peCases.showDisabled || c.enabled) && peCaseMatches(c));
    const byPrompt = peGroupByPrompt(visible);
    const disabledCount = peCases.list.filter(c => !c.enabled).length;
    return `
    <div class="pe-history__toolbar">
        <input class="pe-input pe-cases__search" data-action="case-filter" placeholder="Поиск по id, названию, тегу, промпту…" value="${peEscape(peCases.filter)}">
        <label class="pe-check"><input type="checkbox" data-action="case-show-disabled" ${peCases.showDisabled ? 'checked' : ''}> отключённые (${disabledCount})</label>
        <button class="pe-btn" data-action="case-new"><i data-lucide="plus" class="w-4 h-4"></i> Новый кейс</button>
    </div>
    ${Object.entries(byPrompt).sort(([a], [b]) => a.localeCompare(b)).map(([prompt, cases]) => `
    <div class="pe-group">
        ${pePromptTitle(prompt, ` <span class="pe-muted">${cases.length}</span>`)}
        ${cases.map(c => `
        <div class="pe-case-row ${c.enabled ? '' : 'pe-case-row--disabled'}">
            <div class="pe-case-row__main">
                <div class="pe-case-row__name">${peEscape(c.name)} <span class="pe-muted">${peEscape(c.id)} · r${c.revision}</span>
                    ${c.enabled ? '' : '<span class="pe-badge pe-badge--warn">отключён</span>'}</div>
                <div class="pe-case-row__desc">${peEscape(c.description)}</div>
                <div class="pe-muted">«${peEscape(c.input)}» · ${peEscape(c.suite)} · ${peEscape(c.stage)} · ${peEscape(c.response_format)}${c.judge ? ' · judge' : ''}
                    · ${c.prompts.map(peEscape).join(', ')}${c.tags.length ? ` · #${c.tags.map(peEscape).join(' #')}` : ''}
                    ${(c.rules || []).length ? `<br>правила: ${c.rules.map(peEscape).join(', ')}${c.expect.rules_followed ? ' (проверяет Jev)' : ''}` : ''}
                    · ${peEscape(c.updated_by || '—')}, ${peFormatDate(c.updated_at)}</div>
            </div>
            <button class="pe-icon-btn" data-action="case-edit" data-case="${peEscape(c.id)}" title="Редактировать"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button class="pe-icon-btn" data-action="case-duplicate" data-case="${peEscape(c.id)}" title="Дублировать"><i data-lucide="copy" class="w-4 h-4"></i></button>
            <button class="pe-icon-btn" data-action="case-toggle" data-case="${peEscape(c.id)}" data-enabled="${c.enabled ? '0' : '1'}"
                title="${c.enabled ? 'Отключить' : 'Включить'}"><i data-lucide="${c.enabled ? 'eye-off' : 'eye'}" class="w-4 h-4"></i></button>
        </div>`).join('')}
    </div>`).join('') || '<div class="pe-empty">Ничего не найдено</div>'}`;
}

// --- Editor ---

function peToggleChips(field, values, selected) {
    return values.map(value => {
        const on = selected.includes(value);
        return `<button type="button" class="pe-chip pe-chip--btn pe-chip--${on ? 'on' : 'off'}" data-action="case-chip" data-field="${field}" data-value="${peEscape(value)}">${peEscape(value)}</button>`;
    }).join('');
}

function peTextField(label, field, value, options = {}) {
    const attrs = `data-action="case-field" data-field="${field}" ${options.placeholder ? `placeholder="${peEscape(options.placeholder)}"` : ''}`;
    const control = options.multiline
        ? `<textarea class="pe-input pe-textarea" rows="${options.rows || 2}" ${attrs}>${peEscape(value)}</textarea>`
        : `<input class="pe-input ${options.short ? 'pe-input--short' : ''}" type="${options.type || 'text'}" ${options.list ? `list="${options.list}"` : ''} ${attrs} value="${peEscape(value)}" ${options.disabled ? 'disabled' : ''}>`;
    return `<label class="pe-field ${options.wide ? 'pe-field--wide' : ''}">${label}${control}${options.hint ? `<span class="pe-muted">${options.hint}</span>` : ''}</label>`;
}

function peCheckField(label, field, checked) {
    return `<label class="pe-check"><input type="checkbox" data-action="case-field" data-field="${field}" ${checked ? 'checked' : ''}> ${label}</label>`;
}

function peSelectField(label, field, values, selected, emptyLabel) {
    return `<label class="pe-field">${label}<select class="pe-input" data-action="case-field" data-field="${field}">
        ${emptyLabel ? `<option value="" ${!selected ? 'selected' : ''}>${emptyLabel}</option>` : ''}
        ${values.map(v => `<option value="${peEscape(v)}" ${v === selected ? 'selected' : ''}>${peEscape(v)}</option>`).join('')}
    </select></label>`;
}

function peRenderEditor() {
    const editor = peCases.editor;
    const draft = editor.draft;
    const schema = peCases.schema;
    const expect = draft.expect;
    const suites = [...new Set(peCases.list.map(c => c.suite))].sort();
    const isUi = draft.response_format === 'ui_answer';
    const expectFields = draft.stage === 'stage1' ? `
        <div class="pe-section--row">${peSelectField('Тип действия Stage 1', 'expect.action_type', schema.action_types, expect.action_type, '— не проверять')}</div>
        <div class="pe-field">Должны быть вызваны tools<div class="pe-quick">${peToggleChips('expect.tools_called', schema.tools, expect.tools_called || [])}</div></div>`
        : `
        <div class="pe-section--row">
            ${peCheckField('Ответ не пустой', 'expect.content_not_empty', expect.content_not_empty)}
            ${peTextField('Макс. токенов', 'expect.max_total_tokens', expect.max_total_tokens ?? '', { type: 'number', short: true, hint: 'промпт Stage 1 ≈ 8k' })}
            ${peTextField('Макс. время, мс', 'expect.max_latency_ms', expect.max_latency_ms ?? '', { type: 'number', short: true })}
            ${peTextField('Текст содержит', 'expect.text_contains', expect.text_contains ?? '', {})}
            ${peCheckField('Jev проверяет защищаемые правила', 'expect.rules_followed', expect.rules_followed)}
        </div>
        ${isUi ? `
        <div class="pe-section--row">
            ${peTextField('Мин. UI-элементов', 'expect.min_ui_items', expect.min_ui_items ?? '', { type: 'number', short: true })}
            ${peCheckField('Есть быстрые действия', 'expect.has_quick_actions', expect.has_quick_actions)}
            ${peCheckField('Есть форма (event/note/email)', 'expect.has_form', expect.has_form)}
        </div>
        <div class="pe-field">Должны быть типы элементов<div class="pe-quick">${peToggleChips('expect.expected_item_types', schema.item_types, expect.expected_item_types || [])}</div></div>` : ''}`;
    return `
    <form id="pe-case-form" class="pe-launch" data-form="case">
        <div class="pe-editor__head">
            <button type="button" class="pe-btn pe-btn--ghost pe-btn--small" data-action="case-close"><i data-lucide="arrow-left" class="w-4 h-4"></i> К списку</button>
            <span class="pe-run-head__reason">${editor.mode === 'create' ? 'Новый кейс' : `${peEscape(draft.id)} · r${editor.revision}`}</span>
            ${editor.mode === 'edit' ? '<button type="button" class="pe-btn pe-btn--ghost pe-btn--small" data-action="case-revisions"><i data-lucide="history" class="w-4 h-4"></i> История правок</button>' : ''}
        </div>
        ${editor.error ? `<div class="pe-error-line">${peEscape(editor.error)}</div>` : ''}
        ${editor.revisions ? `
        <section class="pe-section">
            <div class="pe-section__title">История правок</div>
            ${editor.revisions.map(rev => `
            <div class="pe-revision">
                <span>r${rev.revision}</span>
                <span class="pe-muted">${peEscape(rev.author || '—')} · ${peFormatDate(rev.created_at)}${rev.enabled ? '' : ' · отключён'}</span>
                <span class="pe-muted pe-revision__text">«${peEscape(rev.data.input)}» — ${peEscape(rev.data.description)}</span>
                <button type="button" class="pe-btn pe-btn--ghost pe-btn--small" data-action="case-load-revision" data-revision="${rev.revision}">В форму</button>
            </div>`).join('')}
        </section>` : ''}
        <section class="pe-section">
            <div class="pe-section--row">
                ${peTextField('Группа (suite)', 'suite', draft.suite, { short: true, list: 'pe-suites-list', disabled: editor.mode === 'edit' })}
                ${peTextField('ID', 'id', draft.id, { placeholder: 'suite.slug', disabled: editor.mode === 'edit', hint: editor.mode === 'edit' ? 'не меняется — используйте «Дублировать»' : 'латиница, цифры, _ и точки' })}
                ${peTextField('Название', 'name', draft.name, { wide: true })}
            </div>
            <datalist id="pe-suites-list">${suites.map(s => `<option value="${peEscape(s)}">`).join('')}</datalist>
            ${peTextField('Что проверяет кейс и какое правило промпта защищает', 'description', draft.description, { multiline: true, wide: true })}
            ${peTextField('Сообщение пользователя', 'input', draft.input, { multiline: true, wide: true })}
            <div class="pe-section--row">
                ${peSelectField('Стадия', 'stage', schema.stages, draft.stage)}
                ${peSelectField('Формат ответа', 'response_format', schema.response_formats, draft.response_format)}
                ${draft.stage === 'full' && isUi ? peCheckField('LLM-judge', 'judge', draft.judge) : ''}
                ${peTextField('Теги', 'tags', draft.tags.join(', '), { placeholder: 'через запятую' })}
            </div>
            <div class="pe-field">Защищаемые правила спецификаций <span class="pe-muted">по ним кейс выбирается для прогона после фикса правила; правила cmd_prompt проверяются tools / типом действия</span>
                <div class="pe-quick">${peToggleChips('rules', (schema.rules || {})[draft.response_format] || [], draft.rules || [])}</div></div>
            <div class="pe-field">Дополнительные промпты <span class="pe-muted">cmd_prompt и format_* определяются автоматически</span>
                <div class="pe-quick">${peToggleChips('extra_prompts', schema.prompts.filter(p => p !== 'cmd_prompt' && !p.startsWith('format_')), draft.extra_prompts)}</div></div>
        </section>
        <section class="pe-section">
            <div class="pe-section__title">Проверки</div>
            ${expectFields}
        </section>
        <div class="pe-launch__footer">
            <button type="button" class="pe-btn pe-btn--ghost" data-action="case-close">Отмена</button>
            ${peState.catalog && peState.catalog.models.length ? `
            <label class="pe-field pe-field--inline">Прогнать на
                <select class="pe-input" data-action="case-run-model">
                    ${peState.catalog.models.map(m => `<option ${m === peCaseRunModel() ? 'selected' : ''}>${peEscape(m)}</option>`).join('')}
                </select></label>
            <button type="button" class="pe-btn" data-action="case-save" data-run="1" ${editor.saving ? 'disabled' : ''}><i data-lucide="play" class="w-4 h-4"></i> Сохранить и прогнать</button>`
            : '<span class="pe-muted">Прогон недоступен: агент не отдал список моделей</span>'}
            <button type="submit" class="pe-btn" ${editor.saving ? 'disabled' : ''}><i data-lucide="save" class="w-4 h-4"></i> Сохранить</button>
        </div>
    </form>`;
}

async function peRenderCases() {
    if (!peCases.list || !peCases.schema) await peLoadCases();
    if (!peState.catalog) await peLoadCatalog();
    return peCases.editor ? peRenderEditor() : peRenderCaseList();
}

function peOpenCaseEditor(caseId, duplicate = false) {
    const testCase = peCases.list && peCases.list.find(c => c.id === caseId);
    if (!testCase) return;
    const draft = peDraftFromCase(testCase);
    if (duplicate) {
        draft.id = `${draft.id}_copy`;
        draft.name = `${draft.name} (копия)`;
    }
    peCases.editor = { mode: duplicate ? 'create' : 'edit', draft, revision: testCase.revision, error: null, revisions: null, saving: false };
    peSwitchTab('cases');
}

function peCaseRunModel() {
    return peCases.runModel || peState.catalog.default_model;
}

async function peSaveCase(runAfter) {
    const editor = peCases.editor;
    const draft = peCleanDraft(editor.draft);
    editor.saving = true;
    editor.error = null;
    peRenderBody();
    try {
        const saved = editor.mode === 'create'
            ? await peFetch('/cases/', { method: 'POST', body: JSON.stringify(draft) })
            : await peFetch(`/cases/${encodeURIComponent(draft.id)}/`, { method: 'PUT', body: JSON.stringify(draft) });
        peInvalidateCatalog();
        peCases.editor = null;
        if (runAfter) {
            await peLoadCatalog();
            const run = await peFetch('/runs/start/', {
                method: 'POST',
                body: JSON.stringify({ case_ids: [saved.id], models: [peCaseRunModel()], reason: `Проверка кейса ${saved.id} r${saved.revision}` }),
            });
            peConnectRun(run.run_id);
            peSwitchTab('run');
            return;
        }
    } catch (error) {
        editor.error = error.message;
    } finally {
        editor.saving = false;
    }
    peRenderBody();
}

// --- Events (called from PromptEvals.js handlers; return true when handled) ---

function peSetDraftValue(field, value) {
    const draft = peCases.editor.draft;
    if (field.startsWith('expect.')) draft.expect[field.slice(7)] = value;
    else draft[field] = value;
}

function peGetDraftValue(field) {
    const draft = peCases.editor.draft;
    return field.startsWith('expect.') ? draft.expect[field.slice(7)] : draft[field];
}

async function peCasesClick(target, action) {
    if (!action.startsWith('case-')) return false;
    if (action === 'case-new') {
        peCases.editor = { mode: 'create', draft: peEmptyDraft(), revision: 0, error: null, revisions: null, saving: false };
    } else if (action === 'case-edit' || action === 'case-duplicate') {
        if (!peCases.list || !peCases.schema) await peLoadCases();
        peOpenCaseEditor(target.dataset.case, action === 'case-duplicate');
        return true;
    } else if (action === 'case-toggle') {
        await peFetch(`/cases/${encodeURIComponent(target.dataset.case)}/enabled/`, { method: 'POST', body: JSON.stringify({ enabled: target.dataset.enabled === '1' }) });
        peInvalidateCatalog();
    } else if (action === 'case-close') {
        peCases.editor = null;
    } else if (action === 'case-chip') {
        const values = [...(peGetDraftValue(target.dataset.field) || [])];
        const index = values.indexOf(target.dataset.value);
        if (index >= 0) values.splice(index, 1); else values.push(target.dataset.value);
        peSetDraftValue(target.dataset.field, values);
    } else if (action === 'case-revisions') {
        peCases.editor.revisions = peCases.editor.revisions ? null
            : (await peFetch(`/cases/${encodeURIComponent(peCases.editor.draft.id)}/revisions/`)).revisions;
    } else if (action === 'case-load-revision') {
        const revision = peCases.editor.revisions.find(rev => String(rev.revision) === target.dataset.revision);
        peCases.editor.draft = peDraftFromCase(revision.data);
        peCases.editor.error = `Загружена r${revision.revision}. Сохраните, чтобы вернуть её как новую правку.`;
    } else if (action === 'case-save') {
        await peSaveCase(target.dataset.run === '1');
        return true;
    } else {
        return false;
    }
    peRenderBody();
    return true;
}

function peCasesChange(target, action) {
    if (action === 'case-run-model') {
        peCases.runModel = target.value;
        return true;
    }
    if (action === 'case-show-disabled') {
        peCases.showDisabled = target.checked;
        peRenderBody();
        return true;
    }
    if (action !== 'case-field') return false;
    const field = target.dataset.field;
    if (target.type === 'checkbox') peSetDraftValue(field, target.checked);
    else if (target.tagName === 'SELECT') peSetDraftValue(field, target.value || null);
    else return true;
    // Stage, format and judge change which fields are shown
    peRenderBody();
    return true;
}

function peCasesInput(target, action) {
    if (action === 'case-filter') {
        peCases.filter = target.value;
        const position = target.selectionStart;
        peRenderBody().then(() => {
            const input = document.querySelector('#pe-body [data-action="case-filter"]');
            if (input) { input.focus(); input.setSelectionRange(position, position); }
        });
        return true;
    }
    if (action !== 'case-field' || target.type === 'checkbox' || target.tagName === 'SELECT') return action === 'case-field';
    const field = target.dataset.field;
    let value = target.value;
    if (field === 'tags') value = value.split(',').map(tag => tag.trim()).filter(Boolean);
    else if (target.type === 'number') value = value === '' ? null : Number(value);
    peSetDraftValue(field, value);
    if (field === 'suite' && peCases.editor.mode === 'create') {
        const idInput = document.querySelector('#pe-body [data-field="id"]');
        const draft = peCases.editor.draft;
        const slug = draft.id.includes('.') ? draft.id.split('.').slice(1).join('.') : '';
        draft.id = `${value}.${slug}`;
        if (idInput) idInput.value = draft.id;
    }
    return true;
}
