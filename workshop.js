// Realmweaver — окно «Мастерская миров».
//
// Сверху: строка статуса (что действует в этом чате), выбор пакета из
// библиотеки, блок «Где действует» и выключатель на чат.
// Ниже три вкладки: Параметры / Источники / Пакет.
// На этапах 1–2 живая только вкладка «Пакет» — тексты пишутся руками.
// «Параметры» появятся на этапе 4, «Источники» — на этапе 3.
//
// Окно — штатный Popup таверны, тот же механизм, что в Plotweaver.

import {
    ctx,
    getSettings,
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

async function countTokens(text) {
    const str = String(text || '');
    if (!str.trim()) return 0;
    try {
        return await ctx().getTokenCountAsync(str);
    } catch {
        // Подстраховка, если токенайзер недоступен: грубо — 1 токен на ~3.5 символа.
        return Math.ceil(str.length / 3.5);
    }
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
                <div class="rlw-stub">Параметры мира появятся на этапе 4 — вместе с генерацией.</div>
            </div>

            <div class="rlw-tab-panel" data-tab="sources">
                <div class="rlw-stub">Карточка, персона и лорбуки появятся на этапе 3.</div>
            </div>

            <div class="rlw-tab-panel" data-tab="package">
                <button type="button" class="menu_button rlw-generate" disabled title="Генерация появится на этапе 4">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>Сгенерировать пакет</span>
                </button>

                <div class="rlw-field">
                    <div class="rlw-field-head">
                        <span class="rlw-label">Полный пакет</span>
                        <span class="rlw-tokens" data-for="full"></span>
                    </div>
                    <textarea class="text_pole rlw-text" data-field="full" rows="14"
                        placeholder="Здесь будет фактура мира. Пока можно вписать руками."></textarea>
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
// Окно
// ---------------------------------------------------------------------------

export async function openWorkshop() {
    if (!hasChat()) {
        toastr.info('Открой чат — мастерской нужен чат, к которому привязывать мир.', 'Realmweaver');
        return;
    }

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
    };

    const renderTabs = () => {
        $root.find('.rlw-tab').each(function () {
            $(this).attr('aria-pressed', String($(this).data('tab') === activeTab));
        });
        $root.find('.rlw-tab-panel').each(function () {
            $(this).toggleClass('rlw-tab-panel--active', $(this).data('tab') === activeTab);
        });
    };

    const renderAll = () => {
        renderStatus();
        renderSelect();
        renderPlacement();
        renderTexts();
        renderTabs();
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
    });
    await popup.show();
}
