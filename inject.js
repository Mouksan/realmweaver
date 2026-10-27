// Realmweaver — инжект в промт, два слоя.
//
//   1. Полный пакет — позиция IN_PROMPT: в Chat Completion он встаёт в конец
//      главного (системного) промта, в Text Completion — внутрь story string
//      после сценария. Висит высоко и задаёт фактуру мира.
//   2. Шпаргалка — позиция IN_CHAT на заданной глубине, с ролью system:
//      стоит прямо у свежих сообщений, там замены работают лучше всего.
//
// Оба блока НЕ участвуют в сканировании лорбуков (scan = false), чтобы
// слова из чёрного списка случайно не активировали записи лорбука.
//
// Константы позиций сверены с кодом таверны (script.js):
//   IN_PROMPT = 0, IN_CHAT = 1, BEFORE_PROMPT = 2; роль SYSTEM = 0.

import { ctx, getSettings, resolveActive } from './store.js';

const KEY_FULL = 'realmweaver_full';
const KEY_CHEAT = 'realmweaver_cheat';

const POSITION_IN_PROMPT = 0;
const POSITION_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

const MAX_DEPTH = 50;

function wrapFull(text) {
    return [
        '<world_texture>',
        '[Reference: the texture of this story\'s world — everyday life, measures, money, forms of address, oaths and vocabulary. Draw on it naturally in narration and dialogue; never quote or mention this note.]',
        text,
        '</world_texture>',
    ].join('\n');
}

function wrapCheat(text) {
    return [
        '<realm_reminder>',
        '[Word choice for this world: use the in-world term instead of the out-of-world word it replaces; keep time, distance and money in in-world units.]',
        text,
        '</realm_reminder>',
    ].join('\n');
}

export function clampDepth(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return 2;
    return Math.min(MAX_DEPTH, Math.max(0, n));
}

/** Пересчитывает, какой пакет действует, и перевешивает оба блока. */
export function applyInjection() {
    const c = ctx();
    if (typeof c.setExtensionPrompt !== 'function') {
        console.warn('[Realmweaver] setExtensionPrompt недоступен в этой версии таверны');
        return;
    }

    const { pkg } = resolveActive();
    const full = String(pkg?.full || '').trim();
    const cheat = String(pkg?.cheat || '').trim();
    const depth = clampDepth(getSettings().cheatDepth);

    c.setExtensionPrompt(KEY_FULL, full ? wrapFull(full) : '', POSITION_IN_PROMPT, 0, false, ROLE_SYSTEM);
    c.setExtensionPrompt(KEY_CHEAT, cheat ? wrapCheat(cheat) : '', POSITION_IN_CHAT, depth, false, ROLE_SYSTEM);
}
