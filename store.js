// Realmweaver — хранилище.
//
// Здесь живёт всё, что расширение помнит:
//   - глобальные настройки и БИБЛИОТЕКА ПАКЕТОВ — в extension_settings
//     (общие на всю таверну, переживают перезапуск);
//   - ПРИВЯЗКИ к персонажам — тоже в extension_settings: «аватар персонажа →
//     id пакета». Аватар — это имя png-файла карточки, он уникален;
//   - ПЕРЕБИВКА на конкретный чат — в chatMetadata, то есть прямо в файле
//     чата: «в этом чате действует другой пакет» или «тут выключено».
//
// Какой пакет действует сейчас: перебивка чата → привязка персонажа → ничего.

export const MODULE = 'realmweaver';
const CHAT_KEY = 'realmweaver';

export function ctx() {
    return SillyTavern.getContext();
}

// ---------------------------------------------------------------------------
// Глобальные настройки
// ---------------------------------------------------------------------------

const DEFAULTS = {
    enabled: true,
    profileId: '',
    responseTokens: 4000,
    loreTokenLimit: 30000,
    cheatDepth: 2,
    packages: {},
    bindings: {},
    lastPackageId: '',
};

/** Живой объект настроек (с подстраховкой дефолтами для новых полей). */
export function getSettings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE] || typeof all[MODULE] !== 'object') all[MODULE] = {};
    const s = all[MODULE];
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (s[key] === undefined) {
            s[key] = value && typeof value === 'object' ? structuredClone(value) : value;
        }
    }
    return s;
}

export function saveSettings() {
    ctx().saveSettingsDebounced();
}

// ---------------------------------------------------------------------------
// Текущий чат и персонаж
// ---------------------------------------------------------------------------

export function hasChat() {
    try {
        return Boolean(ctx().getCurrentChatId?.());
    } catch {
        return false;
    }
}

export function isGroupChat() {
    return Boolean(ctx().groupId);
}

/** { avatar, name } персонажа текущего чата; null — если чат групповой или его нет. */
export function currentCharacter() {
    const c = ctx();
    if (c.groupId) return null;
    if (c.characterId === undefined || c.characterId === null) return null;
    const character = c.characters?.[c.characterId];
    if (!character?.avatar) return null;
    return { avatar: character.avatar, name: character.name || character.avatar };
}

// ---------------------------------------------------------------------------
// Библиотека пакетов
// ---------------------------------------------------------------------------

function makeId() {
    return `rlw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getPackage(id) {
    if (!id) return null;
    return getSettings().packages[id] || null;
}

/** Все пакеты, по алфавиту. */
export function listPackages() {
    return Object.values(getSettings().packages)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}

export function createPackage(name) {
    const s = getSettings();
    const now = Date.now();
    const pkg = {
        id: makeId(),
        name: String(name || 'Новый мир').trim() || 'Новый мир',
        full: '',
        cheat: '',
        // Ниже — заготовки под этапы 3–4 (параметры, модули, источники).
        params: {},
        modules: {},
        sources: {},
        createdAt: now,
        updatedAt: now,
    };
    s.packages[pkg.id] = pkg;
    s.lastPackageId = pkg.id;
    saveSettings();
    return pkg;
}

export function renamePackage(id, name) {
    const pkg = getPackage(id);
    const clean = String(name || '').trim();
    if (!pkg || !clean) return null;
    pkg.name = clean;
    pkg.updatedAt = Date.now();
    saveSettings();
    return pkg;
}

export function updatePackageTexts(id, { full, cheat }) {
    const pkg = getPackage(id);
    if (!pkg) return null;
    if (typeof full === 'string') pkg.full = full;
    if (typeof cheat === 'string') pkg.cheat = cheat;
    pkg.updatedAt = Date.now();
    saveSettings();
    return pkg;
}

/**
 * Удаляет пакет и снимает всё, что на него ссылалось: привязки ко всем
 * персонажам и перебивку в текущем чате. Перебивки в ДРУГИХ чатах лежат в их
 * файлах — их подчистит cleanupChatState(), когда ты откроешь тот чат
 * (а до тех пор мёртвая ссылка просто игнорируется).
 */
export function deletePackage(id) {
    const s = getSettings();
    delete s.packages[id];
    for (const [avatar, pkgId] of Object.entries(s.bindings)) {
        if (pkgId === id) delete s.bindings[avatar];
    }
    if (getChatState()?.packageId === id) setChatState({ packageId: null });
    if (s.lastPackageId === id) s.lastPackageId = '';
    saveSettings();
}

export function setLastPackage(id) {
    const s = getSettings();
    if (s.lastPackageId === id) return;
    s.lastPackageId = id || '';
    saveSettings();
}

// ---------------------------------------------------------------------------
// Перебивка на уровне чата (chatMetadata)
// ---------------------------------------------------------------------------

/** { packageId, disabled } для текущего чата; null — если чата нет. */
export function getChatState() {
    if (!hasChat()) return null;
    const meta = ctx().chatMetadata;
    if (!meta || typeof meta !== 'object') return null;
    const raw = meta[CHAT_KEY];
    return {
        packageId: raw?.packageId || null,
        disabled: Boolean(raw?.disabled),
    };
}

export function setChatState(patch) {
    if (!hasChat()) return;
    const c = ctx();
    const meta = c.chatMetadata;
    if (!meta || typeof meta !== 'object') return;
    const next = { ...(getChatState() || {}), ...patch };
    // Пустое состояние не храним — файл чата остаётся чистым.
    if (!next.packageId && !next.disabled) delete meta[CHAT_KEY];
    else meta[CHAT_KEY] = { packageId: next.packageId || null, disabled: Boolean(next.disabled) };

    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else c.saveMetadata?.();
}

/** Если чат ссылается на удалённый пакет — убираем мёртвую ссылку. */
export function cleanupChatState() {
    const state = getChatState();
    if (state?.packageId && !getPackage(state.packageId)) {
        setChatState({ packageId: null });
    }
}

// ---------------------------------------------------------------------------
// Привязки к персонажам
// ---------------------------------------------------------------------------

/** Персонажа переименовали — у него сменился файл аватара, переносим привязку. */
export function moveBinding(oldAvatar, newAvatar) {
    const s = getSettings();
    if (!oldAvatar || !newAvatar || !s.bindings[oldAvatar]) return;
    s.bindings[newAvatar] = s.bindings[oldAvatar];
    delete s.bindings[oldAvatar];
    saveSettings();
}

/** Персонажа удалили — привязка больше не нужна (сам пакет остаётся в библиотеке). */
export function dropBinding(avatar) {
    const s = getSettings();
    if (!avatar || !s.bindings[avatar]) return;
    delete s.bindings[avatar];
    saveSettings();
}

// ---------------------------------------------------------------------------
// «Где действует» — для выбранного в мастерской пакета
// ---------------------------------------------------------------------------

/** 'chat' | 'character' | 'nowhere' — как этот пакет связан с текущим чатом. */
export function getPlacement(pkgId) {
    if (getChatState()?.packageId === pkgId) return 'chat';
    const character = currentCharacter();
    if (character && getSettings().bindings[character.avatar] === pkgId) return 'character';
    return 'nowhere';
}

export function setPlacement(pkgId, mode) {
    const s = getSettings();
    const character = currentCharacter();
    const chatState = getChatState();
    const boundHere = character && s.bindings[character.avatar] === pkgId;

    if (mode === 'nowhere') {
        if (boundHere) delete s.bindings[character.avatar];
        if (chatState?.packageId === pkgId) setChatState({ packageId: null });
    } else if (mode === 'character') {
        if (!character) return;
        s.bindings[character.avatar] = pkgId;
        // Если этот же пакет стоял перебивкой чата — она больше не нужна.
        if (chatState?.packageId === pkgId) setChatState({ packageId: null });
    } else if (mode === 'chat') {
        setChatState({ packageId: pkgId });
        // «Только в этом чате» = не во всех чатах, поэтому привязку снимаем.
        if (boundHere) delete s.bindings[character.avatar];
    }
    saveSettings();
}

// ---------------------------------------------------------------------------
// Какой пакет действует прямо сейчас
// ---------------------------------------------------------------------------

/**
 * Возвращает { state, pkg, character }.
 * state: 'off-global' | 'no-chat' | 'off-chat' | 'chat' | 'character' | 'none'.
 * С ignoreSwitches=true выключатели не учитываются — это нужно мастерской,
 * чтобы при открытии показать «свой» пакет, даже если он сейчас выключен.
 */
export function resolveActive({ ignoreSwitches = false } = {}) {
    const s = getSettings();
    if (!ignoreSwitches && !s.enabled) return { state: 'off-global', pkg: null };
    if (!hasChat()) return { state: 'no-chat', pkg: null };

    const chatState = getChatState();
    if (!ignoreSwitches && chatState?.disabled) return { state: 'off-chat', pkg: null };

    const chatPkg = getPackage(chatState?.packageId);
    if (chatPkg) return { state: 'chat', pkg: chatPkg };

    const character = currentCharacter();
    if (character) {
        const boundPkg = getPackage(s.bindings[character.avatar]);
        if (boundPkg) return { state: 'character', pkg: boundPkg, character };
    }
    return { state: 'none', pkg: null };
}
