// Realmweaver — запрос к модели и разбор ответа.
//
// Запрос идёт ТОЛЬКО через выбранный профиль подключения (Connection
// Manager), как в Plotweaver. Основная модель чата не трогается.
//
// Модель отвечает двумя блоками: <full>…</full> и <cheat>…</cheat>.
// Разбор терпим к мелким огрехам: если закрывающего тега нет (ответ
// обрезало по лимиту), берём текст до конца.

import { ctx, getSettings } from './store.js';
import { buildReviewMessages } from './prompt.js';

// Запас на «невидимое» мышление reasoning-моделей (Gemini и т.п. тратят
// лимит ответа и на размышления) — тот же приём, что в Plotweaver.
const REASONING_HEADROOM = 4096;

// Пакет короче этого считаем мусором и не сохраняем.
const MIN_FULL_LENGTH = 50;

export class EmptyResponseError extends Error {
    constructor() {
        super('Empty or malformed response');
        this.name = 'EmptyResponseError';
    }
}

/** Убирает «мышление», если оно просочилось в текст (включая твои теги <rp_preflight>). */
function stripReasoning(text) {
    return String(text || '')
        .replace(/<(think|thinking|reasoning|thought|rp_preflight)>[\s\S]*?<\/\1>/gi, '')
        .replace(/^[\s\S]*?<\/(?:think|thinking|reasoning|thought|rp_preflight)>/i, '')
        .trim();
}

function stripFences(text) {
    return String(text || '')
        .replace(/^```[a-z]*\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
}

/**
 * Разбирает ответ модели.
 * Возвращает { full, cheat }; cheat может быть пустым.
 * Бросает EmptyResponseError, если полезного текста нет.
 */
export function parsePackage(raw) {
    const text = stripFences(stripReasoning(raw));

    const cheatMatch = text.match(/<cheat>\s*([\s\S]*?)\s*(?:<\/cheat>|$)/i);
    const cheat = cheatMatch ? stripFences(cheatMatch[1]) : '';

    let full = '';
    const fullMatch = text.match(/<full>\s*([\s\S]*?)\s*(?:<\/full>|<cheat>|$)/i);
    if (fullMatch) {
        full = fullMatch[1];
    } else {
        // Тегов нет — берём всё, кроме блока шпаргалки.
        full = text.replace(/<cheat>[\s\S]*?(?:<\/cheat>|$)/i, '');
    }
    full = stripFences(full.replace(/<\/?full>/gi, ''));

    if (full.length < MIN_FULL_LENGTH) throw new EmptyResponseError();
    return { full, cheat };
}

/** Текст ошибки провайдера — по-английски, как есть, чтобы его можно было загуглить. */
export function errorText(error) {
    return error?.cause?.message || error?.message || String(error);
}

/**
 * Отправляет сообщения через выбранный профиль и возвращает сырой текст ответа.
 */
export async function requestCompletion(messages, signal) {
    const s = getSettings();
    const service = ctx().ConnectionManagerRequestService;
    if (!service) throw new Error('Connection Manager is not available');

    // Для Text Completion профилей сообщения надо склеить по шаблону instruct —
    // это делает сама таверна; для Chat Completion массив уходит как есть.
    const prompt = typeof service.constructPrompt === 'function'
        ? service.constructPrompt(messages, s.profileId)
        : messages;

    const result = await service.sendRequest(s.profileId, prompt, s.responseTokens + REASONING_HEADROOM, {
        stream: false,
        extractData: true,
        includePreset: true,
        signal,
    });
    const content = result?.content;
    if (typeof content === 'string') return content;
    return content ? JSON.stringify(content) : '';
}

/**
 * Самопроверка: второй запрос, где модель-редактор чинит готовый пакет
 * по чек-листу. Возвращает исправленные { full, cheat }; если редактор не
 * вернул шпаргалку, оставляем прежнюю — она уже была проверена глазами
 * или просто не нуждалась в правке.
 */
export async function reviewPackage(pkg, full, cheat, signal) {
    const raw = await requestCompletion(buildReviewMessages(pkg, full, cheat), signal);
    const fixed = parsePackage(raw);
    return { full: fixed.full, cheat: fixed.cheat || cheat };
}

