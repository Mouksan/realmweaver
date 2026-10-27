// Realmweaver — источники для генерации пакета.
//
// Отвечает на три вопроса:
//   1. Какие лорбуки активны в текущем чате (и откуда: чат, персонаж,
//      персона, глобальные) — чтобы поставить их наверх списка с галочками.
//   2. Сколько токенов весит каждый лорбук — для счётчика.
//   3. Какой текст уйдёт модели: карточка, первое сообщение, персона и
//      записи выбранных лорбуков, обрезанные по лимиту токенов.
//
// Лорбуки читаются целиком через loadWorldInfo() — без активации по ключам
// и векторам, как в Plotweaver: для фактуры мира нужно «всё», а не
// «что сейчас сработало». Отключённые записи пропускаются.

import { ctx, getSettings } from './store.js';
import { selected_world_info, world_info, METADATA_KEY } from '../../../world-info.js';

// ---------------------------------------------------------------------------
// Активные лорбуки
// ---------------------------------------------------------------------------

/** Короткие подписи к пометке «активен в чате». */
export const ACTIVE_KIND_LABELS = {
    chat: 'чат',
    character: 'персонаж',
    persona: 'персона',
    global: 'глобальный',
};

function characterFileName(character) {
    return String(character?.avatar || '').replace(/\.[^/.]+$/, '');
}

/**
 * Лорбуки, которые таверна сейчас подключает к этому чату.
 * Возвращает Map: имя → вид ('chat' | 'character' | 'persona' | 'global'),
 * в порядке: чат, персонаж, персона, глобальные. Если один лорбук подключён
 * сразу несколькими способами — берётся первый по этому порядку.
 */
export function getActiveLorebooks() {
    const c = ctx();
    const result = new Map();
    const add = (name, kind) => {
        if (name && !result.has(name)) result.set(name, kind);
    };

    add(c.chatMetadata?.[METADATA_KEY], 'chat');

    // Персонаж: основной лорбук карточки + дополнительные (charLore).
    // В групповом чате — лорбуки всех участников.
    const characters = [];
    if (c.groupId) {
        const group = c.groups?.find((g) => g.id === c.groupId);
        for (const avatar of group?.members || []) {
            const member = c.characters?.find((ch) => ch.avatar === avatar);
            if (member) characters.push(member);
        }
    } else if (c.characterId !== undefined && c.characterId !== null) {
        const character = c.characters?.[c.characterId];
        if (character) characters.push(character);
    }
    for (const character of characters) {
        add(character?.data?.extensions?.world, 'character');
        const extra = world_info?.charLore?.find((e) => e.name === characterFileName(character));
        for (const name of extra?.extraBooks || []) add(name, 'character');
    }

    add(c.powerUserSettings?.persona_description_lorebook, 'persona');

    for (const name of selected_world_info || []) add(name, 'global');

    // Отбрасываем то, чего уже нет среди лорбуков (удалили, а ссылка осталась).
    const existing = new Set(c.getWorldInfoNames?.() || []);
    for (const name of [...result.keys()]) {
        if (!existing.has(name)) result.delete(name);
    }
    return result;
}

/**
 * Полный список для вкладки «Источники»: сначала активные (в их порядке),
 * потом все остальные по алфавиту.
 * Элемент: { name, activeKind | null }
 */
export function getLorebookList() {
    const active = getActiveLorebooks();
    const all = ctx().getWorldInfoNames?.() || [];
    const rest = all
        .filter((name) => !active.has(name))
        .sort((a, b) => a.localeCompare(b, 'ru'));
    return [
        ...[...active.entries()].map(([name, kind]) => ({ name, activeKind: kind })),
        ...rest.map((name) => ({ name, activeKind: null })),
    ];
}

// ---------------------------------------------------------------------------
// Выбор лорбуков в пакете
// ---------------------------------------------------------------------------

/**
 * Какие лорбуки отмечены для этого пакета прямо сейчас.
 *
 * В пакете хранятся два списка:
 *   - lorebooks   — что было отмечено;
 *   - knownActive — какие лорбуки были активны, когда выбор сохраняли.
 * Активный лорбук, которого нет в knownActive, — новый для пакета, его
 * отмечаем сами. А тот, с которого ты сняла галочку, так и остаётся снятым.
 * У пакета, где выбор ещё ни разу не сохраняли, отмечены все активные.
 */
export function resolveLoreSelection(pkg) {
    const active = getActiveLorebooks();
    const sources = pkg?.sources || {};
    if (!Array.isArray(sources.lorebooks)) {
        return new Set(active.keys());
    }
    const selected = new Set(sources.lorebooks);
    const known = new Set(sources.knownActive || []);
    for (const name of active.keys()) {
        if (!known.has(name)) selected.add(name);
    }
    return selected;
}

/** Сохраняет выбор лорбуков в пакет (вместе со снимком активных). */
export function storeLoreSelection(pkg, selectedNames) {
    if (!pkg) return;
    pkg.sources = {
        ...defaultSourceFlags(),
        ...(pkg.sources || {}),
        lorebooks: [...selectedNames],
        knownActive: [...getActiveLorebooks().keys()],
    };
}

// ---------------------------------------------------------------------------
// Галочки «Карточка / Первое сообщение / Персона»
// ---------------------------------------------------------------------------

export function defaultSourceFlags() {
    return { card: true, firstMes: false, persona: true };
}

export function getSourceFlags(pkg) {
    const saved = pkg?.sources || {};
    const defaults = defaultSourceFlags();
    return {
        card: typeof saved.card === 'boolean' ? saved.card : defaults.card,
        firstMes: typeof saved.firstMes === 'boolean' ? saved.firstMes : defaults.firstMes,
        persona: typeof saved.persona === 'boolean' ? saved.persona : defaults.persona,
    };
}

// ---------------------------------------------------------------------------
// Тексты источников
// ---------------------------------------------------------------------------

function cardFields() {
    try {
        return ctx().getCharacterCardFields?.() || {};
    } catch (error) {
        console.warn('[Realmweaver] не удалось прочитать карточку персонажа', error);
        return {};
    }
}

/** Описание, личность и сценарий карточки (в групповом чате — всех участников, как это делает сама таверна). */
export function getCardText() {
    const fields = cardFields();
    const parts = [];
    if (fields.description) parts.push(`## Description\n${fields.description}`);
    if (fields.personality) parts.push(`## Personality\n${fields.personality}`);
    if (fields.scenario) parts.push(`## Scenario\n${fields.scenario}`);
    return parts.join('\n\n');
}

export function getFirstMessageText() {
    const c = ctx();
    if (c.groupId) return '';
    const character = c.characters?.[c.characterId];
    const raw = String(character?.first_mes || '').trim();
    if (!raw) return '';
    try {
        return c.substituteParams(raw);
    } catch {
        return raw;
    }
}

export function getPersonaText() {
    return String(cardFields().persona || '').trim();
}

/** Записи лорбука в порядке, как в редакторе таверны; без отключённых и пустых. */
async function loadLoreEntries(name) {
    try {
        const book = await ctx().loadWorldInfo?.(name);
        const entries = book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : [];
        return entries
            .filter((e) => !e?.disable && String(e?.content || '').trim())
            .sort((a, b) => (a.displayIndex ?? a.uid ?? 0) - (b.displayIndex ?? b.uid ?? 0))
            .map((e) => {
                const title = String(e.comment || '').trim();
                const content = String(e.content).trim();
                return title ? `### ${title}\n${content}` : content;
            });
    } catch (error) {
        console.warn(`[Realmweaver] не удалось прочитать лорбук "${name}"`, error);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Токены
// ---------------------------------------------------------------------------

export async function countTokens(text) {
    const str = String(text || '');
    if (!str.trim()) return 0;
    try {
        return await ctx().getTokenCountAsync(str);
    } catch {
        // Подстраховка, если токенайзер недоступен: грубо — 1 токен на ~3.5 символа.
        return Math.ceil(str.length / 3.5);
    }
}

// Вес лорбука считаем один раз за открытие мастерской — лорбуки не меняются,
// пока окно открыто, а гонять токенайзер по 30к токенов на каждый клик не хочется.
const loreTokenCache = new Map();

export function resetLoreTokenCache() {
    loreTokenCache.clear();
}

export async function countLorebookTokens(name) {
    if (loreTokenCache.has(name)) return loreTokenCache.get(name);
    const promise = loadLoreEntries(name).then((entries) => countTokens(entries.join('\n\n')));
    loreTokenCache.set(name, promise);
    return promise;
}

// ---------------------------------------------------------------------------
// Сборка текста для модели (понадобится на этапе 4)
// ---------------------------------------------------------------------------

/**
 * Собирает источники в один текст для модели.
 * Лорбуки идут в порядке списка (сначала активные), записи — как в редакторе.
 * Если выбранные лорбуки толще лимита, записи с конца отрезаются целиком
 * (не рвём запись посередине).
 *
 * Возвращает { text, loreTokens, loreLimit, droppedEntries }.
 */
export async function collectSources(pkg) {
    const flags = getSourceFlags(pkg);
    const blocks = [];

    if (flags.card) {
        const card = getCardText();
        if (card) blocks.push(`# CHARACTER CARD\n${card}`);
    }
    if (flags.firstMes) {
        const first = getFirstMessageText();
        if (first) blocks.push(`# FIRST MESSAGE\n${first}`);
    }
    if (flags.persona) {
        const persona = getPersonaText();
        if (persona) blocks.push(`# USER PERSONA\n${persona}`);
    }

    const loreLimit = getSettings().loreTokenLimit;
    const selected = resolveLoreSelection(pkg);
    const ordered = getLorebookList().map((item) => item.name).filter((name) => selected.has(name));

    let loreTokens = 0;
    let droppedEntries = 0;
    let limitReached = false;

    for (const name of ordered) {
        const entries = await loadLoreEntries(name);
        const kept = [];
        for (const entry of entries) {
            if (limitReached) {
                droppedEntries++;
                continue;
            }
            const tokens = await countTokens(entry);
            if (loreTokens + tokens > loreLimit) {
                limitReached = true;
                droppedEntries++;
                continue;
            }
            loreTokens += tokens;
            kept.push(entry);
        }
        if (kept.length) blocks.push(`# LOREBOOK: ${name}\n${kept.join('\n\n')}`);
    }

    return { text: blocks.join('\n\n'), loreTokens, loreLimit, droppedEntries };
}
