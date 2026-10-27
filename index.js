// Realmweaver — точка входа.
//
// Генератор «фактуры мира» для фэнтези-ролевок против русизмов: из карточки,
// персоны и лорбуков модель собирает пакет (быт, меры, обращения, клятвы,
// чёрный список с заменами), а он висит в промте в два слоя.
//
// Этот файл: ящик настроек в панели расширений, пункт в меню волшебной
// палочки и подписка на события таверны (смена чата, переименование и
// удаление персонажа), чтобы инжект всегда соответствовал открытому чату.

import {
    ctx,
    getSettings,
    saveSettings,
    cleanupChatState,
    moveBinding,
    dropBinding,
} from './store.js';
import { applyInjection, clampDepth } from './inject.js';
import { openWorkshop } from './workshop.js';
import { DEFAULT_INSTRUCTIONS } from './prompt.js';

const EXTENSION_NAME = 'Realmweaver';

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Профили подключения (как в Plotweaver)
// ---------------------------------------------------------------------------

function getConnectionProfiles() {
    try {
        return ctx().ConnectionManagerRequestService?.getSupportedProfiles?.() || [];
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] не удалось получить профили подключения`, error);
        return [];
    }
}

/** Перерисовывает список профилей — профили могут появиться/исчезнуть, пока таверна открыта. */
function renderProfileOptions() {
    const selectedId = getSettings().profileId;
    const profiles = getConnectionProfiles().filter((p) => p?.id);
    const known = profiles.some((p) => p.id === selectedId);

    const options = [`<option value="" ${selectedId ? '' : 'selected'}>— не выбран —</option>`];
    for (const p of profiles) {
        options.push(`<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name || p.id)}</option>`);
    }
    // Выбранный профиль удалили из Connection Manager — показываем это честно, а не молча сбрасываем.
    if (selectedId && !known) {
        options.push(`<option value="${escapeHtml(selectedId)}" selected>(профиль не найден)</option>`);
    }
    $('#rlw_profile').html(options.join(''));
}

// ---------------------------------------------------------------------------
// Ящик настроек
// ---------------------------------------------------------------------------

function settingsHtml() {
    return `
        <div class="realmweaver-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-mountain-sun"></i> Realmweaver</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="rlw-settings-body">
                        <label class="checkbox_label" for="rlw_enabled">
                            <input type="checkbox" id="rlw_enabled">
                            <span>Включить Realmweaver</span>
                        </label>

                        <div class="rlw-set-field">
                            <label for="rlw_profile">Профиль подключения</label>
                            <select id="rlw_profile" class="text_pole"></select>
                            <div class="rlw-hint">Через этот профиль генерируются пакеты. Основная модель чата не трогается.</div>
                        </div>

                        <div class="rlw-set-grid">
                            <div class="rlw-set-field">
                                <label for="rlw_response_tokens">Лимит ответа (токены)</label>
                                <input type="number" id="rlw_response_tokens" class="text_pole" min="500" max="64000" step="100">
                            </div>
                            <div class="rlw-set-field">
                                <label for="rlw_lore_limit">Лимит лорбуков (токены)</label>
                                <input type="number" id="rlw_lore_limit" class="text_pole" min="1000" max="500000" step="1000">
                            </div>
                        </div>
                        <div class="rlw-hint">Если выбранные лорбуки толще — лишние записи отрежутся, начиная с самых последних по порядку.</div>

                        <div class="rlw-set-field rlw-set-field--short">
                            <label for="rlw_cheat_depth">Глубина шпаргалки</label>
                            <input type="number" id="rlw_cheat_depth" class="text_pole" min="0" max="50" step="1">
                        </div>

                        <div class="inline-drawer rlw-prompt-drawer">
                            <div class="inline-drawer-toggle inline-drawer-header">
                                <span>Промт генерации</span>
                                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                            </div>
                            <div class="inline-drawer-content">
                                <div class="rlw-settings-body">
                                    <textarea id="rlw_prompt" class="text_pole" rows="12"></textarea>
                                    <div class="rlw-hint">Общие правила для модели (на английском). Параметры, модули, источники и формат ответа подставляются сами.</div>
                                    <button id="rlw_prompt_reset" class="menu_button">Сбросить к стандартному</button>
                                </div>
                            </div>
                        </div>

                        <button id="rlw_open_btn" class="menu_button rlw-panel-btn">
                            <i class="fa-solid fa-mountain-sun"></i>
                            <span>Открыть мастерскую миров</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function mountSettings() {
    $('#extensions_settings2').append(settingsHtml());
    const s = getSettings();

    $('#rlw_enabled').prop('checked', s.enabled);
    renderProfileOptions();
    $('#rlw_response_tokens').val(s.responseTokens);
    $('#rlw_lore_limit').val(s.loreTokenLimit);
    $('#rlw_cheat_depth').val(s.cheatDepth);

    $('#rlw_enabled').on('change', function () {
        getSettings().enabled = $(this).prop('checked');
        saveSettings();
        applyInjection();
    });

    // Профили могли появиться уже после загрузки расширения — перечитываем
    // их, когда открываешь ящик или ставишь фокус на список.
    $('.realmweaver-settings .inline-drawer-toggle').on('click', renderProfileOptions);
    $('#rlw_profile').on('focus', renderProfileOptions);
    $('#rlw_profile').on('change', function () {
        getSettings().profileId = String($(this).val() || '');
        saveSettings();
    });

    $('#rlw_response_tokens').on('change', function () {
        const value = clampInt($(this).val(), 500, 64000, 4000);
        getSettings().responseTokens = value;
        $(this).val(value);
        saveSettings();
    });

    $('#rlw_lore_limit').on('change', function () {
        const value = clampInt($(this).val(), 1000, 500000, 30000);
        getSettings().loreTokenLimit = value;
        $(this).val(value);
        saveSettings();
    });

    $('#rlw_cheat_depth').on('change', function () {
        const value = clampDepth($(this).val());
        getSettings().cheatDepth = value;
        $(this).val(value);
        saveSettings();
        applyInjection();
    });

    // Промт: в поле всегда видно действующий текст. Если он совпадает со
    // стандартным — храним пустую строку, чтобы будущие улучшения
    // стандартного промта до тебя доезжали.
    $('#rlw_prompt').val(String(s.promptTemplate || '').trim() || DEFAULT_INSTRUCTIONS);
    $('#rlw_prompt').on('input', function () {
        const value = String($(this).val() || '');
        getSettings().promptTemplate = value.trim() === DEFAULT_INSTRUCTIONS.trim() ? '' : value;
        saveSettings();
    });
    $('#rlw_prompt_reset').on('click', () => {
        getSettings().promptTemplate = '';
        $('#rlw_prompt').val(DEFAULT_INSTRUCTIONS);
        saveSettings();
    });

    $('#rlw_open_btn').on('click', openWorkshop);
}

function mountWandMenu() {
    $('#extensionsMenu').append(`
        <div id="rlw_wand_item" class="list-group-item flex-container flexGap5" title="Открыть мастерскую миров">
            <div class="fa-solid fa-mountain-sun extensionsMenuExtensionButton"></div>
            <span>Realmweaver</span>
        </div>
    `);
    $('#rlw_wand_item').on('click', openWorkshop);
}

// ---------------------------------------------------------------------------
// События таверны
// ---------------------------------------------------------------------------

function subscribeEvents() {
    const { eventSource, eventTypes } = ctx();

    // Сменился чат — пересчитываем, какой пакет действует, и перевешиваем блоки.
    // Заодно убираем мёртвую ссылку, если пакет этого чата удалили, пока чат был закрыт.
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        cleanupChatState();
        applyInjection();
    });

    // Переименование персонажа меняет имя файла аватара — переносим привязку.
    eventSource.on(eventTypes.CHARACTER_RENAMED, (oldAvatar, newAvatar) => {
        moveBinding(oldAvatar, newAvatar);
        applyInjection();
    });

    // Персонажа удалили — снимаем его привязку (сам пакет остаётся в библиотеке).
    eventSource.on(eventTypes.CHARACTER_DELETED, (payload) => {
        dropBinding(payload?.character?.avatar);
        applyInjection();
    });
}

jQuery(async () => {
    try {
        getSettings();
        mountSettings();
        mountWandMenu();
        subscribeEvents();
        applyInjection();
        console.log(`[${EXTENSION_NAME}] расширение загружено`);
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] ошибка при загрузке`, error);
    }
});
