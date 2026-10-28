// Realmweaver — окно «Мастерская миров».
//
// Сверху: строка статуса (что действует в этом чате), выбор пакета из
// библиотеки, блок «Где действует» и выключатель на чат.
// Ниже три вкладки: Параметры / Источники / Пакет.
// «Параметры» появятся на этапе 4 вместе с генерацией.
//
// Окно — штатный Popup таверны, тот же механизм, что в Plotweaver.

import {
    ctx,
    getSettings,
    saveSettings,
    hasChat,
    isGroupChat,
    currentCharacter,
    getPackage,
    listPackages,
    createPackage,
    renamePackage,
    deletePackage,
    updatePackageTexts,
    setLastPackage,
    getChatState,
    setChatState,
    getPlacement,
    setPlacement,
    resolveActive,
} from './store.js';
import { applyInjection } from './inject.js';
import {
    ACTIVE_KIND_LABELS,
    countTokens,
    countLorebookTokens,
    resetLoreTokenCache,
    getLorebookList,
    resolveLoreSelection,
    storeLoreSelection,
    getSourceFlags,
    defaultSourceFlags,
    getCardText,
    getFirstMessageText,
    getPersonaText,
    collectSources,
} from './sources.js';
import {
    PARAMS,
    LANGUAGES,
    MODULES,
    getParams,
    getModules,
    hasEnabledModules,
    buildMessages,
} from './prompt.js';
import { requestCompletion, parsePackage, reviewPackage, errorText, EmptyResponseError } from './generate.js';

// Пакеты, над которыми модель работает прямо сейчас: id → фаза
// ('generate' — пишет пакет, 'review' — проверяет). Живёт вне окна: если
// закрыть мастерскую посреди работы, результат всё равно сохранится,
// а при повторном открытии кнопки покажут, что работа идёт.
const busyPackages = new Map();

const TOKEN_COUNT_DELAY = 400; // мс — не считаем токены на каждую букву

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatNumber(n) {
    return Number(n || 0).toLocaleString('ru-RU');
}

async function confirmPopup(text, okText, cancelText) {
    const c = ctx();
    const result = await c.callGenericPopup(text, c.POPUP_TYPE.CONFIRM, '', {
        okButton: okText,
        cancelButton: cancelText,
    });
    return result === c.POPUP_RESULT.AFFIRMATIVE;
}

async function inputPopup(text, defaultValue) {
    const c = ctx();
    const result = await c.callGenericPopup(text, c.POPUP_TYPE.INPUT, defaultValue || '', {
        okButton: 'Готово',
        cancelButton: 'Отмена',
    });
    if (typeof result !== 'string') return null;
    return result.trim() || null;
}

// ---------------------------------------------------------------------------
// Вёрстка
// ---------------------------------------------------------------------------

/** Вкладка «Параметры»: списки, поля и модули — всё из описаний в prompt.js. */
function paramsHtml() {
    // extra — дополнительная разметка под списком (у архетипа это поле «Своё…»).
    const selectHtml = (param, extra = '') => `
        <div class="rlw-param">
            <label class="rlw-param-label" for="rlw-param-${param.id}">${escapeHtml(param.label)}</label>
            <select class="text_pole rlw-param-select" id="rlw-param-${param.id}" data-param="${param.id}">
                ${param.options.map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')}
            </select>
            ${extra}
        </div>`;
    const byId = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

    return `
        <div class="rlw-src-group">
            <div class="rlw-label">Мир</div>
            <div class="rlw-param-grid">
                ${selectHtml(byId.archetype, `
                    <input type="text" class="text_pole rlw-param-text rlw-param-custom" data-param="archetypeCustom"
                        placeholder="Опиши сеттинг своими словами">`)}
                ${selectHtml(byId.tech)}
                ${selectHtml(byId.magic)}
                ${selectHtml(byId.register)}
            </div>
            <div class="rlw-param">
                <label class="rlw-param-label" for="rlw-param-analogue">Реальный аналог для фактуры</label>
                <input type="text" class="text_pole rlw-param-text" id="rlw-param-analogue" data-param="analogue"
                    placeholder="например: империя Сун, Византия, Венеция XV века">
            </div>
            <div class="rlw-param">
                <div class="rlw-param-label">Язык ролевки</div>
                <div class="rlw-segmented">
                    ${LANGUAGES.map((l) => `<button type="button" class="rlw-seg" data-lang="${l.id}">${escapeHtml(l.label)}</button>`).join('')}
                </div>
            </div>
            <div class="rlw-param">
                <label class="rlw-param-label" for="rlw-param-wishes">Пожелания</label>
                <textarea class="text_pole rlw-param-text" id="rlw-param-wishes" data-param="wishes" rows="3"
                    placeholder="например: волки клянутся Луной, зайцы — Матерью-Полем"></textarea>
            </div>
        </div>

        <div class="rlw-src-group">
            <div class="rlw-label">Модули</div>
            <div class="rlw-module-grid">
                ${MODULES.map((m) => `
                    <label class="rlw-src-item">
                        <input type="checkbox" class="rlw-module" data-module="${m.id}">
                        <span class="rlw-src-name">${escapeHtml(m.label)}</span>
                    </label>`).join('')}
            </div>
        </div>
    `;
}

function dialogHtml() {
    return `
        <div class="rlw-head">
            <h3 class="rlw-title"><i class="fa-solid fa-mountain-sun"></i> Мастерская миров</h3>
            <div class="rlw-status"></div>
        </div>

        <div class="rlw-pkg-row">
            <select class="text_pole rlw-pkg-select"></select>
            <button type="button" class="menu_button rlw-pkg-new"><i class="fa-solid fa-plus"></i> Новый</button>
            <button type="button" class="menu_button rlw-pkg-rename"><i class="fa-solid fa-pen"></i> Переименовать</button>
            <button type="button" class="menu_button rlw-pkg-delete"><i class="fa-solid fa-trash-can"></i> Удалить</button>
        </div>

        <div class="rlw-empty">
            В библиотеке пока пусто — нажми «Новый», чтобы завести первый мир.
        </div>

        <div class="rlw-body">
            <div class="rlw-place">
                <div class="rlw-label">Где действует</div>
                <label class="rlw-radio">
                    <input type="radio" name="rlw-place" value="nowhere">
                    <span>Нигде (лежит в библиотеке)</span>
                </label>
                <label class="rlw-radio rlw-radio-character">
                    <input type="radio" name="rlw-place" value="character">
                    <span class="rlw-character-label"></span>
                </label>
                <label class="rlw-radio">
                    <input type="radio" name="rlw-place" value="chat">
                    <span>Только в этом чате</span>
                </label>
                <div class="rlw-hint rlw-group-hint">В групповых чатах работает только «Только в этом чате».</div>
                <label class="checkbox_label rlw-chat-off">
                    <input type="checkbox" class="rlw-chat-off-input">
                    <span>Выключить Realmweaver в этом чате</span>
                </label>
            </div>

            <div class="rlw-tabs" role="tablist">
                <button type="button" class="rlw-tab" data-tab="params">Параметры</button>
                <button type="button" class="rlw-tab" data-tab="sources">Источники</button>
                <button type="button" class="rlw-tab" data-tab="package">Пакет</button>
            </div>

            <div class="rlw-tab-panel" data-tab="params">
                ${paramsHtml()}
            </div>

            <div class="rlw-tab-panel" data-tab="sources">
                <div class="rlw-src-group">
                    <div class="rlw-label">Карточка и персона</div>
                    <label class="rlw-src-item">
                        <input type="checkbox" class="rlw-src-flag" data-flag="card">
                        <span class="rlw-src-name">Карточка персонажа</span>
                        <span class="rlw-tokens" data-src="card"></span>
                    </label>
                    <label class="rlw-src-item">
                        <input type="checkbox" class="rlw-src-flag" data-flag="firstMes">
                        <span class="rlw-src-name">Первое сообщение</span>
                        <span class="rlw-tokens" data-src="firstMes"></span>
                    </label>
                    <label class="rlw-src-item">
                        <input type="checkbox" class="rlw-src-flag" data-flag="persona">
                        <span class="rlw-src-name">Персона</span>
                        <span class="rlw-tokens" data-src="persona"></span>
                    </label>
                </div>

                <div class="rlw-src-group">
                    <div class="rlw-label">Лорбуки</div>
                    <input type="search" class="text_pole rlw-lore-search" placeholder="Поиск лорбука…">
                    <div class="rlw-lore-list"></div>
                    <div class="rlw-lore-counter-bar"><div class="rlw-lore-counter"></div></div>
                </div>
            </div>

            <div class="rlw-tab-panel" data-tab="package">
                <div class="rlw-generate-row">
                    <button type="button" class="menu_button rlw-generate">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                        <span class="rlw-generate-label">Сгенерировать пакет</span>
                    </button>
                    <button type="button" class="menu_button rlw-check" title="Модель перечитает пакет по чек-листу и исправит нарушения">
                        <i class="fa-solid fa-list-check"></i>
                        <span>Проверить пакет</span>
                    </button>
                </div>

                <div class="rlw-field">
                    <div class="rlw-field-head">
                        <span class="rlw-label">Полный пакет</span>
                        <span class="rlw-tokens" data-for="full"></span>
                    </div>
                    <textarea class="text_pole rlw-text" data-field="full" rows="14"
                        placeholder="Здесь будет фактура мира — сгенерируй её или впиши руками."></textarea>
                </div>

                <div class="rlw-field">
                    <div class="rlw-field-head">
                        <span class="rlw-label">Шпаргалка (висит у свежих сообщений)</span>
                        <span class="rlw-tokens" data-for="cheat"></span>
                    </div>
                    <textarea class="text_pole rlw-text" data-field="cheat" rows="6"
                        placeholder="Пары «вместо → говорим» и меры времени. Коротко."></textarea>
                </div>

                <div class="rlw-footer">
                    <button type="button" class="menu_button rlw-save" disabled>
                        <i class="fa-solid fa-floppy-disk"></i> Сохранить правки
                    </button>
                    <button type="button" class="menu_button rlw-revert" disabled>
                        <i class="fa-solid fa-rotate-left"></i> Откатить
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Генерация (живёт вне окна, чтобы пережить его закрытие)
// ---------------------------------------------------------------------------

// Открытые окна подписываются сюда, чтобы перерисоваться, когда генерация
// началась или закончилась.
const generationListeners = new Set();

function notifyGeneration() {
    for (const listener of generationListeners) {
        try {
            listener();
        } catch (error) {
            console.warn('[Realmweaver] ошибка при обновлении окна', error);
        }
    }
}

/** Проверки до генерации; если что-то не так — тост и false. */
function canGenerate(pkg) {
    if (!pkg) return false;
    if (!getSettings().profileId) {
        toastr.warning('Не выбран профиль подключения — загляни в настройки Realmweaver.', 'Realmweaver');
        return false;
    }
    if (!hasEnabledModules(pkg)) {
        toastr.warning('Включи хотя бы один модуль во вкладке «Параметры».', 'Realmweaver');
        return false;
    }
    return true;
}

/** Проверки до ручной самопроверки. */
function canReview(pkg) {
    if (!pkg) return false;
    if (!getSettings().profileId) {
        toastr.warning('Не выбран профиль подключения — загляни в настройки Realmweaver.', 'Realmweaver');
        return false;
    }
    return Boolean(String(pkg.full || '').trim());
}

function setBusy(pkgId, phase) {
    if (phase) busyPackages.set(pkgId, phase);
    else busyPackages.delete(pkgId);
    notifyGeneration();
}

async function generatePackage(pkgId) {
    const pkg = getPackage(pkgId);
    if (!pkg || busyPackages.has(pkgId) || !canGenerate(pkg)) return;

    setBusy(pkgId, 'generate');
    try {
        // Фиксируем в пакете выбор лорбуков, с которым он генерировался.
        storeLoreSelection(pkg, resolveLoreSelection(pkg));
        saveSettings();

        const { text } = await collectSources(pkg);
        if (!text.trim()) {
            toastr.warning('Источники пустые — отметь карточку, персону или лорбуки во вкладке «Источники».', 'Realmweaver');
            return;
        }

        const raw = await requestCompletion(buildMessages(pkg, text));
        let { full, cheat } = parsePackage(raw);

        // Самопроверка: второй запрос, модель-редактор чинит пакет по чек-листу.
        // Если он упал — сохраняем то, что получилось на первом проходе.
        if (getSettings().selfCheck && getPackage(pkgId)) {
            setBusy(pkgId, 'review');
            try {
                ({ full, cheat } = await reviewPackage(pkg, full, cheat));
            } catch (error) {
                console.warn('[Realmweaver] самопроверка не удалась', error);
                toastr.warning('Самопроверка не удалась — сохранён пакет без неё.', 'Realmweaver');
            }
        }

        if (!getPackage(pkgId)) return; // пакет удалили, пока ждали ответа
        updatePackageTexts(pkgId, { full, cheat });
        applyInjection();

        if (!cheat) toastr.warning('Шпаргалку модель не выдала — допиши руками или перегенерируй.', 'Realmweaver');
        toastr.success(`Пакет «${getPackage(pkgId).name}» готов.`, 'Realmweaver');
    } catch (error) {
        if (error instanceof EmptyResponseError) {
            toastr.error('Модель вернула что-то странное — пакет не сохранён. Попробуй ещё раз.', 'Realmweaver');
        } else {
            console.error('[Realmweaver] генерация не удалась', error);
            toastr.error(`Генерация не удалась: ${errorText(error)}`, 'Realmweaver');
        }
    } finally {
        setBusy(pkgId, null);
    }
}

/** Ручная самопроверка уже готового пакета — без перегенерации. */
async function checkPackage(pkgId) {
    const pkg = getPackage(pkgId);
    if (!pkg || busyPackages.has(pkgId) || !canReview(pkg)) return;

    setBusy(pkgId, 'review');
    try {
        const { full, cheat } = await reviewPackage(pkg, pkg.full, pkg.cheat);
        if (!getPackage(pkgId)) return;
        updatePackageTexts(pkgId, { full, cheat });
        applyInjection();
        toastr.success(`Пакет «${getPackage(pkgId).name}» проверен.`, 'Realmweaver');
    } catch (error) {
        if (error instanceof EmptyResponseError) {
            toastr.error('Модель вернула что-то странное — пакет не изменён. Попробуй ещё раз.', 'Realmweaver');
        } else {
            console.error('[Realmweaver] проверка не удалась', error);
            toastr.error(`Проверка не удалась: ${errorText(error)}`, 'Realmweaver');
        }
    } finally {
        setBusy(pkgId, null);
    }
}

// ---------------------------------------------------------------------------
// Окно
// ---------------------------------------------------------------------------

export async function openWorkshop() {
    if (!hasChat()) {
        toastr.info('Открой чат — мастерской нужен чат, к которому привязывать мир.', 'Realmweaver');
        return;
    }

    // Лорбуки могли поменяться с прошлого открытия — вес считаем заново.
    resetLoreTokenCache();

    const root = document.createElement('div');
    root.classList.add('rlw-dialog');
    root.innerHTML = dialogHtml();
    const $root = $(root);

    // id пакета, открытого в мастерской сейчас. При открытии — тот, что
    // действует в этом чате; если такого нет — последний, с которым работала.
    let selectedId = resolveActive({ ignoreSwitches: true }).pkg?.id
        || (getPackage(getSettings().lastPackageId) ? getSettings().lastPackageId : '')
        || listPackages()[0]?.id
        || '';
    let activeTab = 'package';
    const tokenTimers = {};

    // --- Мелкие помощники ---------------------------------------------------

    const textValue = (field) => String($root.find(`.rlw-text[data-field="${field}"]`).val() ?? '');

    const isDirty = () => {
        const pkg = getPackage(selectedId);
        if (!pkg) return false;
        return textValue('full') !== String(pkg.full || '') || textValue('cheat') !== String(pkg.cheat || '');
    };

    const refreshDirtyButtons = () => {
        const dirty = isDirty();
        $root.find('.rlw-save, .rlw-revert').prop('disabled', !dirty);
    };

    const refreshTokens = (field) => {
        clearTimeout(tokenTimers[field]);
        tokenTimers[field] = setTimeout(async () => {
            const count = await countTokens(textValue(field));
            $root.find(`.rlw-tokens[data-for="${field}"]`).text(count ? `≈ ${formatNumber(count)} токенов` : '');
        }, TOKEN_COUNT_DELAY);
    };

    const renderStatus = () => {
        const { state, pkg } = resolveActive();
        const character = currentCharacter();
        let text = '';
        switch (state) {
            case 'character':
                text = `Сейчас действует: «${pkg.name}» — во всех чатах с ${character?.name || 'персонажем'}`;
                break;
            case 'chat':
                text = `Сейчас действует: «${pkg.name}» — только в этом чате`;
                break;
            case 'off-chat':
                text = 'Realmweaver выключен в этом чате';
                break;
            case 'off-global':
                text = 'Realmweaver выключен в настройках расширения';
                break;
            default:
                text = 'Пакета нет — в промт ничего не идёт';
        }
        $root.find('.rlw-status')
            .text(text)
            .toggleClass('rlw-status--active', state === 'character' || state === 'chat');
    };

    const renderSelect = () => {
        const packages = listPackages();
        const $select = $root.find('.rlw-pkg-select');
        if (!packages.length) {
            $select.html('<option value="" disabled selected>— пакетов пока нет —</option>');
        } else {
            $select.html(packages
                .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
                .join(''));
        }
        $root.find('.rlw-pkg-rename, .rlw-pkg-delete').prop('disabled', !packages.length);
        $root.find('.rlw-empty').toggle(!packages.length);
        $root.find('.rlw-body').toggle(Boolean(packages.length));
    };

    const renderPlacement = () => {
        const group = isGroupChat();
        const character = currentCharacter();
        const $characterRadio = $root.find('.rlw-radio-character');
        $characterRadio.find('input').prop('disabled', group || !character);
        $characterRadio.toggleClass('rlw-radio--disabled', group || !character);
        $root.find('.rlw-character-label').text(character ? `Во всех чатах с ${character.name}` : 'Во всех чатах с персонажем');
        $root.find('.rlw-group-hint').toggle(group);

        const placement = selectedId ? getPlacement(selectedId) : 'nowhere';
        $root.find(`input[name="rlw-place"][value="${placement}"]`).prop('checked', true);
        $root.find('.rlw-chat-off-input').prop('checked', Boolean(getChatState()?.disabled));
    };

    const renderTexts = () => {
        const pkg = getPackage(selectedId);
        $root.find('.rlw-text[data-field="full"]').val(pkg?.full || '');
        $root.find('.rlw-text[data-field="cheat"]').val(pkg?.cheat || '');
        refreshTokens('full');
        refreshTokens('cheat');
        refreshDirtyButtons();
        renderGenerateButton();
    };

    // --- Вкладка «Источники» ------------------------------------------------

    // Список лорбуков, нарисованный сейчас: [{ name, activeKind }]. Чекбоксы
    // ссылаются на него по индексу — так не нужно экранировать имена с
    // кавычками в селекторах.
    let loreItems = [];
    // Для какого пакета вкладка уже нарисована — чтобы не перерисовывать
    // (и не перечитывать лорбуки) на каждом переключении вкладок.
    let sourcesRenderedFor = null;
    let counterRun = 0;

    const loreTokensText = (count) => `≈ ${formatNumber(count)}`;

    const checkedLoreNames = () => $root.find('.rlw-lore-check:checked')
        .map(function () { return loreItems[Number($(this).data('idx'))]?.name; })
        .get()
        .filter(Boolean);

    /** Подпись под списком: сколько токенов весят отмеченные лорбуки. */
    const refreshLoreCounter = async () => {
        const run = ++counterRun;
        const limit = getSettings().loreTokenLimit;
        const names = checkedLoreNames();
        const $counter = $root.find('.rlw-lore-counter');
        if (!names.length) {
            $counter.text(`Выбрано: 0 токенов из ${formatNumber(limit)}`).removeClass('rlw-lore-counter--over');
            return;
        }
        $counter.text('Выбрано: считаю…').removeClass('rlw-lore-counter--over');
        const counts = await Promise.all(names.map((name) => countLorebookTokens(name)));
        if (run !== counterRun) return; // пока считали, галочки уже поменяли
        const total = counts.reduce((sum, n) => sum + n, 0);
        const over = total > limit;
        $counter
            .text(`Выбрано: ≈${formatNumber(total)} токенов из ${formatNumber(limit)}${over ? ' — лишнее отрежется' : ''}`)
            .toggleClass('rlw-lore-counter--over', over);
    };

    /** Вес лорбука рядом с его именем — считаем только для отмеченных. */
    const refreshLoreItemTokens = (idx) => {
        const item = loreItems[idx];
        if (!item) return;
        countLorebookTokens(item.name).then((count) => {
            $root.find(`.rlw-tokens[data-lore-idx="${idx}"]`).text(loreTokensText(count));
        });
    };

    const renderSources = () => {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        sourcesRenderedFor = selectedId;

        // Галочки карточки/первого сообщения/персоны и их вес.
        const flags = getSourceFlags(pkg);
        const texts = { card: getCardText(), firstMes: getFirstMessageText(), persona: getPersonaText() };
        for (const flag of Object.keys(texts)) {
            $root.find(`.rlw-src-flag[data-flag="${flag}"]`).prop('checked', flags[flag]);
            const $tokens = $root.find(`.rlw-tokens[data-src="${flag}"]`);
            if (!texts[flag]) {
                $tokens.text('пусто');
            } else {
                countTokens(texts[flag]).then((count) => $tokens.text(loreTokensText(count)));
            }
        }

        // Лорбуки: активные сверху, остальные ниже.
        loreItems = getLorebookList();
        const selected = resolveLoreSelection(pkg);
        const $list = $root.find('.rlw-lore-list');
        if (!loreItems.length) {
            $list.html('<div class="rlw-hint">Лорбуков в таверне не найдено.</div>');
        } else {
            const hasActive = loreItems.some((item) => item.activeKind);
            const hasRest = loreItems.some((item) => !item.activeKind);
            let html = '';
            loreItems.forEach((item, idx) => {
                if (hasActive && hasRest && !item.activeKind && (idx === 0 || loreItems[idx - 1].activeKind)) {
                    html += '<div class="rlw-lore-divider">Остальные лорбуки</div>';
                }
                const pill = item.activeKind
                    ? `<span class="rlw-pill">активен в чате · ${ACTIVE_KIND_LABELS[item.activeKind]}</span>`
                    : '';
                html += `
                    <label class="rlw-lore-item ${item.activeKind ? 'rlw-lore-item--active' : ''}" data-search="${escapeHtml(item.name.toLowerCase())}">
                        <input type="checkbox" class="rlw-lore-check" data-idx="${idx}" ${selected.has(item.name) ? 'checked' : ''}>
                        <span class="rlw-lore-name">${escapeHtml(item.name)}</span>
                        ${pill}
                        <span class="rlw-tokens" data-lore-idx="${idx}"></span>
                    </label>
                `;
            });
            $list.html(html);
            loreItems.forEach((item, idx) => {
                if (selected.has(item.name)) refreshLoreItemTokens(idx);
            });
        }
        $root.find('.rlw-lore-search').val('');
        refreshLoreCounter();
    };

    const renderTabs = () => {
        $root.find('.rlw-tab').each(function () {
            $(this).attr('aria-pressed', String($(this).data('tab') === activeTab));
        });
        $root.find('.rlw-tab-panel').each(function () {
            $(this).toggleClass('rlw-tab-panel--active', $(this).data('tab') === activeTab);
        });
        // Источники рисуем лениво — только когда на них смотрят.
        if (activeTab === 'sources' && sourcesRenderedFor !== selectedId) renderSources();
    };

    // --- Вкладка «Параметры» -----------------------------------------------

    const renderParams = () => {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        const params = getParams(pkg);
        const modules = getModules(pkg);
        $root.find('.rlw-param-select').each(function () {
            $(this).val(params[String($(this).data('param'))]);
        });
        $root.find('.rlw-param-text').each(function () {
            $(this).val(params[String($(this).data('param'))] || '');
        });
        $root.find('.rlw-param-custom').toggle(params.archetype === 'custom');
        $root.find('.rlw-seg').each(function () {
            $(this).attr('aria-pressed', String($(this).data('lang') === params.language));
        });
        $root.find('.rlw-module').each(function () {
            $(this).prop('checked', Boolean(modules[String($(this).data('module'))]));
        });
    };

    const setParam = (key, value) => {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        pkg.params = { ...getParams(pkg), [key]: value };
        saveSettings();
    };

    // --- Кнопка генерации ----------------------------------------------------

    // Пакет, генерацию которого это окно ждёт: когда она закончится,
    // текстовые поля надо перерисовать готовым результатом.
    let awaitedId = busyPackages.has(selectedId) ? selectedId : null;

    const renderGenerateButton = () => {
        const pkg = getPackage(selectedId);
        const phase = busyPackages.get(selectedId) || null;
        const busy = Boolean(phase);
        const hasText = Boolean(pkg && (String(pkg.full || '').trim() || String(pkg.cheat || '').trim()));
        const hasFull = Boolean(pkg && String(pkg.full || '').trim());
        const $button = $root.find('.rlw-generate');
        $button.prop('disabled', busy || !pkg).toggleClass('rlw-generate--busy', busy);
        $button.find('i').attr('class', busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-wand-magic-sparkles');
        const busyLabel = phase === 'review' ? 'Проверяю…' : 'Генерирую…';
        $button.find('.rlw-generate-label').text(busy ? busyLabel : (hasText ? 'Перегенерировать' : 'Сгенерировать пакет'));
        // «Проверить пакет» — только когда есть что проверять.
        $root.find('.rlw-check').toggle(hasFull || busy).prop('disabled', busy);
        // Пока модель работает, поля только для чтения — иначе правки затрёт результат.
        $root.find('.rlw-text').prop('readonly', busy);
    };

    const onGenerationChange = () => {
        if (awaitedId && !busyPackages.has(awaitedId)) {
            if (awaitedId === selectedId) renderTexts();
            awaitedId = null;
        }
        renderStatus();
        renderGenerateButton();
    };

    const renderAll = () => {
        sourcesRenderedFor = null;
        renderStatus();
        renderSelect();
        renderPlacement();
        renderTexts();
        renderParams();
        renderTabs();
        renderGenerateButton();
    };

    /** Что-то поменялось в привязках или текстах — перевешиваем инжект и статус. */
    const afterChange = () => {
        applyInjection();
        renderStatus();
    };

    const saveTexts = () => {
        if (!selectedId) return;
        updatePackageTexts(selectedId, { full: textValue('full'), cheat: textValue('cheat') });
        afterChange();
        refreshDirtyButtons();
        renderGenerateButton();
    };

    /**
     * Перед тем как уйти с пакета (переключение, создание нового, закрытие
     * окна) — если есть несохранённые правки, спрашиваем, что с ними делать.
     */
    const resolveDirty = async () => {
        if (!isDirty()) return;
        const keep = await confirmPopup('В пакете есть несохранённые правки. Сохранить?', 'Сохранить', 'Выбросить');
        if (keep) {
            saveTexts();
            toastr.success('Правки сохранены.', 'Realmweaver');
        }
    };

    const selectPackage = (id) => {
        selectedId = id || '';
        awaitedId = busyPackages.has(selectedId) ? selectedId : null;
        if (selectedId) setLastPackage(selectedId);
        renderAll();
    };

    // --- Обработчики ---------------------------------------------------------

    $root.on('change', '.rlw-pkg-select', async function () {
        const nextId = String($(this).val() || '');
        if (nextId === selectedId) return;
        // Пока решаем судьбу правок, в селекте остаётся старый пакет.
        $(this).val(selectedId);
        await resolveDirty();
        selectPackage(nextId);
    });

    $root.on('click', '.rlw-pkg-new', async () => {
        await resolveDirty();
        const character = currentCharacter();
        const name = await inputPopup('Название нового пакета', character ? `Мир ${character.name}` : 'Новый мир');
        if (!name) return;
        const pkg = createPackage(name);
        selectPackage(pkg.id);
    });

    $root.on('click', '.rlw-pkg-rename', async () => {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        const name = await inputPopup('Новое название пакета', pkg.name);
        if (!name) return;
        renamePackage(pkg.id, name);
        renderSelect();
        renderStatus();
    });

    $root.on('click', '.rlw-pkg-delete', async () => {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        const ok = await confirmPopup(`Удалить пакет «${escapeHtml(pkg.name)}»? Привязки к нему тоже снимутся.`, 'Удалить', 'Отмена');
        if (!ok) return;
        deletePackage(pkg.id);
        applyInjection();
        selectPackage(listPackages()[0]?.id || '');
    });

    $root.on('change', 'input[name="rlw-place"]', function () {
        if (!selectedId) return;
        setPlacement(selectedId, String($(this).val()));
        afterChange();
        renderPlacement();
    });

    $root.on('change', '.rlw-chat-off-input', function () {
        setChatState({ disabled: $(this).prop('checked') });
        afterChange();
    });

    $root.on('click', '.rlw-tab', function () {
        activeTab = String($(this).data('tab'));
        renderTabs();
    });

    $root.on('change', '.rlw-src-flag', function () {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        pkg.sources = { ...defaultSourceFlags(), ...(pkg.sources || {}), [String($(this).data('flag'))]: $(this).prop('checked') };
        saveSettings();
    });

    $root.on('change', '.rlw-lore-check', function () {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        storeLoreSelection(pkg, checkedLoreNames());
        saveSettings();
        if ($(this).prop('checked')) refreshLoreItemTokens(Number($(this).data('idx')));
        refreshLoreCounter();
    });

    $root.on('input', '.rlw-lore-search', function () {
        const query = String($(this).val() || '').trim().toLowerCase();
        $root.find('.rlw-lore-item').each(function () {
            $(this).toggle(!query || String($(this).attr('data-search') || '').includes(query));
        });
        $root.find('.rlw-lore-divider').toggle(!query);
    });

    $root.on('change', '.rlw-param-select', function () {
        const key = String($(this).data('param'));
        setParam(key, String($(this).val()));
        if (key === 'archetype') $root.find('.rlw-param-custom').toggle($(this).val() === 'custom');
    });

    $root.on('input', '.rlw-param-text', function () {
        setParam(String($(this).data('param')), String($(this).val() ?? ''));
    });

    $root.on('click', '.rlw-seg', function () {
        setParam('language', String($(this).data('lang')));
        renderParams();
    });

    $root.on('change', '.rlw-module', function () {
        const pkg = getPackage(selectedId);
        if (!pkg) return;
        pkg.modules = { ...getModules(pkg), [String($(this).data('module'))]: $(this).prop('checked') };
        saveSettings();
    });

    $root.on('click', '.rlw-generate', async () => {
        const pkg = getPackage(selectedId);
        if (!pkg || busyPackages.has(pkg.id) || !canGenerate(pkg)) return;
        const hasText = String(pkg.full || '').trim() || String(pkg.cheat || '').trim();
        if (hasText || isDirty()) {
            const ok = await confirmPopup('Перегенерировать? Ручные правки в этом пакете пропадут.', 'Перегенерировать', 'Отмена');
            if (!ok) return;
            renderTexts(); // несохранённые правки в полях выбрасываем
        }
        awaitedId = pkg.id;
        generatePackage(pkg.id);
    });

    $root.on('click', '.rlw-check', async () => {
        const pkg = getPackage(selectedId);
        if (!pkg || busyPackages.has(pkg.id)) return;
        // Проверяем то, что в полях: несохранённые правки сначала сохраняем (или выбрасываем).
        await resolveDirty();
        if (!canReview(pkg)) return;
        awaitedId = pkg.id;
        checkPackage(pkg.id);
    });

    $root.on('input', '.rlw-text', function () {
        refreshTokens(String($(this).data('field')));
        refreshDirtyButtons();
    });

    $root.on('click', '.rlw-save', () => {
        saveTexts();
        toastr.success('Правки сохранены.', 'Realmweaver');
    });

    $root.on('click', '.rlw-revert', () => {
        renderTexts();
    });

    // --- Показ ---------------------------------------------------------------

    renderAll();
    generationListeners.add(onGenerationChange);

    const c = ctx();
    const popup = new c.Popup(root, c.POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: false,
        cancelButton: 'Закрыть',
        onClosing: async () => {
            await resolveDirty();
            return true;
        },
        onClose: () => {
            generationListeners.delete(onGenerationChange);
        },
    });
    await popup.show();
}
