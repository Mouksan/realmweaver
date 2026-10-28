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
        .replace(/\r\n?/g, '\n')
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
export async function requestCompletion(messages, signal, profileId = getSettings().profileId) {
    const s = getSettings();
    const service = ctx().ConnectionManagerRequestService;
    if (!service) throw new Error('Connection Manager is not available');

    // Для Text Completion профилей сообщения надо склеить по шаблону instruct —
    // это делает сама таверна; для Chat Completion массив уходит как есть.
    const prompt = typeof service.constructPrompt === 'function'
        ? service.constructPrompt(messages, profileId)
        : messages;

    const result = await service.sendRequest(profileId, prompt, s.responseTokens + REASONING_HEADROOM, {
        stream: false,
        extractData: true,
        includePreset: true,
        signal,
    });
    const content = result?.content;
    if (typeof content === 'string') return content;
    return content ? JSON.stringify(content) : '';
}

// ---------------------------------------------------------------------------
// Чистка пар «X → Y» кодом, без модели
// ---------------------------------------------------------------------------

const BARE_BAN = /нет замены|не существу|no replacement|does not exist|doesn['’]t exist/i;

function normalizePairSide(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\([^)]*\)/g, '')
        .replace(/[.!?,;:«»"'`*]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Чистит строки с парами «X → Y»: выкидывает пары X → X, голые запреты
 * («нет замены») и повторы одного и того же X. Подпись строки
 * («- Время: …») сохраняется, строка без пар исчезает. Строки без стрелок
 * не трогаются.
 */
export function cleanPairs(text) {
    const seen = new Set();
    const out = [];
    for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
        if (!line.includes('→')) {
            out.push(line);
            continue;
        }
        const m = line.match(/^(\s*(?:[-*•]\s*)?)(.*)$/) || ['', '', line];
        const bullet = m[1];
        let rest = m[2];
        let label = '';
        const colon = rest.indexOf(':');
        if (colon !== -1 && colon < rest.indexOf('→')) {
            label = rest.slice(0, colon + 1) + ' ';
            rest = rest.slice(colon + 1).trim();
        }
        const endsWithDot = /\.\s*$/.test(rest);
        const kept = [];
        for (const raw of rest.replace(/\.\s*$/, '').split(';')) {
            const pair = raw.trim();
            if (!pair) continue;
            const arrow = pair.indexOf('→');
            if (arrow === -1) {
                kept.push(pair);
                continue;
            }
            const left = normalizePairSide(pair.slice(0, arrow));
            const right = pair.slice(arrow + 1).trim();
            const rightNorm = normalizePairSide(right);
            if (!left || !rightNorm || BARE_BAN.test(right)) continue;
            const rightOptions = rightNorm.split('/').map((x) => x.trim());
            if (rightOptions.every((x) => x === left)) continue; // X → X
            if (seen.has(left)) continue; // повтор
            seen.add(left);
            kept.push(pair);
        }
        if (kept.length) out.push(`${bullet}${label}${kept.join('; ')}${endsWithDot ? '.' : ''}`);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Разбор пакета на части для самопроверки
// ---------------------------------------------------------------------------

const BLACKLIST_HEADER = /^##\s*.*(ч[её]рн|blacklist|замен)/im;

/** Делит полный пакет на «всё остальное» и раздел чёрного списка. */
export function splitBlacklist(full) {
    const text = String(full || '').replace(/\r\n?/g, '\n');
    const match = text.match(BLACKLIST_HEADER);
    if (!match) return { body: text.trim(), blacklist: '' };
    const start = match.index;
    const after = text.slice(start + match[0].length);
    const next = after.search(/^##\s/m);
    const end = next === -1 ? text.length : start + match[0].length + next;
    return {
        body: (text.slice(0, start) + text.slice(end)).trim(),
        blacklist: text.slice(start, end).trim(),
    };
}

/**
 * Самопроверка: второй запрос, где модель-редактор чинит пакет по чек-листу.
 *
 * Чёрный список и пары шпаргалки редактору НЕ отдаём: модели склонны
 * «чинить» левую часть пар (где наши слова стоят по делу) и превращают
 * список в «соларис → соларис». Эти части код вырезает, а после проверки
 * возвращает на место, вычистив мусор без модели. Редактор правит остальной
 * пакет и строки-сводки шпаргалки (единицы времени, расстояний, денег).
 */
export async function reviewPackage(pkg, full, cheat, signal) {
    const { body, blacklist } = splitBlacklist(full);
    const cheatLines = String(cheat || '').split('\n');
    const cheatPairs = cheatLines.filter((l) => l.includes('→')).join('\n');
    const cheatSummary = cheatLines.filter((l) => l.trim() && !l.includes('→')).join('\n');

    const profileId = getSettings().reviewProfileId || getSettings().profileId;
    const raw = await requestCompletion(buildReviewMessages(pkg, body, cheatSummary), signal, profileId);
    const fixed = parsePackage(raw);

    // Если редактор всё же вернул пары в шпаргалке — берём только сводку.
    const fixedSummary = String(fixed.cheat || '').split('\n').filter((l) => l.trim() && !l.includes('→')).join('\n');
    // Если редактор всё же дописал свой чёрный список — выбрасываем его, ставим исходный.
    const fixedBody = splitBlacklist(fixed.full).body;
    const newFull = [fixedBody, cleanPairs(blacklist)].filter(Boolean).join('\n\n');
    const newCheat = [cleanPairs(cheatPairs), fixedSummary || cheatSummary].filter(Boolean).join('\n');
    return { full: newFull, cheat: newCheat };
}
