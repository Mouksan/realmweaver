// Realmweaver — параметры мира, модули и сборка промта для генерации.
//
// Подписи для интерфейса — по-русски, а всё, что уходит модели, — на
// английском (модели лучше держат инструкции на английском, как и в
// Plotweaver). Сам пакет модель пишет на языке ролевки.
//
// Промт состоит из двух сообщений:
//   system — общие правила (их можно переписать в настройках расширения);
//   user   — источники, параметры, список разделов, язык и формат ответа.
//            Эта часть собирается сама, её руками не правят.

import { getSettings } from './store.js';

// ---------------------------------------------------------------------------
// Параметры мира
// ---------------------------------------------------------------------------

/** У каждого списка первый вариант — «Авто»: модель решает сама по источникам. */
export const PARAMS = [
    {
        id: 'archetype',
        label: 'Архетип сеттинга',
        promptLabel: 'Setting archetype',
        options: [
            { id: 'auto', label: 'Авто (по карточке и лорбукам)' },
            { id: 'western', label: 'Западное средневековое фэнтези', prompt: 'Western medieval fantasy' },
            { id: 'xianxia', label: 'Сянься и уся', prompt: 'Chinese xianxia / wuxia: cultivation world, sects, imperial court' },
            { id: 'eastern_court', label: 'Восточный двор (Япония, Корея)', prompt: 'East Asian court fantasy in a Japanese / Korean vein' },
            { id: 'middle_eastern', label: 'Ближневосточное фэнтези', prompt: 'Middle Eastern fantasy: deserts, caliphates, bazaars' },
            { id: 'slavic', label: 'Славянское фэнтези', prompt: 'Slavic fantasy (here Slavic folk vocabulary is NATIVE to the world — do not treat it as foreign)' },
            { id: 'steampunk', label: 'Стимпанк и магитех', prompt: 'Steampunk / magitech' },
            { id: 'custom', label: 'Своё…' },
        ],
    },
    {
        id: 'tech',
        label: 'Технологический уровень',
        promptLabel: 'Technology level',
        options: [
            { id: 'auto', label: 'Авто (по карточке и лорбукам)' },
            { id: 'antiquity', label: 'Древность', prompt: 'antiquity' },
            { id: 'early_medieval', label: 'Раннее средневековье', prompt: 'early middle ages' },
            { id: 'late_medieval', label: 'Позднее средневековье', prompt: 'late middle ages' },
            { id: 'renaissance', label: 'Ренессанс', prompt: 'renaissance' },
            { id: 'gunpowder', label: 'Пороховая эпоха', prompt: 'early modern gunpowder age' },
            { id: 'magitech', label: 'Магитех', prompt: 'magitech — machinery driven by magic' },
        ],
    },
    {
        id: 'magic',
        label: 'Магия в быту',
        promptLabel: 'Magic in everyday life',
        options: [
            { id: 'auto', label: 'Авто (по карточке и лорбукам)' },
            { id: 'none', label: 'Нет', prompt: 'none — daily life works without magic' },
            { id: 'rare', label: 'Редкая', prompt: 'rare — known, but exceptional and not part of ordinary chores' },
            { id: 'common', label: 'Обычная', prompt: 'common — part of daily life for many people' },
            { id: 'everywhere', label: 'Повсюду', prompt: 'pervasive — daily life runs on magic' },
        ],
    },
    {
        id: 'register',
        label: 'Регистр речи',
        promptLabel: 'Speech register',
        options: [
            { id: 'auto', label: 'Авто (по карточке и лорбукам)' },
            { id: 'high', label: 'Высокий архаичный', prompt: 'high, archaic, ceremonial' },
            { id: 'literary', label: 'Книжный нейтральный', prompt: 'neutral literary' },
            { id: 'earthy', label: 'Простонародный, грубоватый', prompt: 'earthy, colloquial, a little coarse' },
        ],
    },
];

export const LANGUAGES = [
    { id: 'ru', label: 'Русский' },
    { id: 'en', label: 'English' },
];

export function defaultParams() {
    return {
        archetype: 'auto',
        archetypeCustom: '',
        tech: 'auto',
        magic: 'auto',
        register: 'auto',
        analogue: '',
        wishes: '',
        language: 'ru',
    };
}

export function getParams(pkg) {
    return { ...defaultParams(), ...(pkg?.params || {}) };
}

// ---------------------------------------------------------------------------
// Модули (разделы пакета)
// ---------------------------------------------------------------------------

function blacklistInstruction(language) {
    if (language === 'en') {
        return 'This roleplay is written in ENGLISH. List at least 30 words and phrases from OUR world that a model is likely to slip into THIS setting — modern idioms and slang (okay, deadline, adrenaline, stressed out, on autopilot), technical, office and psychology jargon, Earth units (seconds, minutes, hours as precise units, miles, meters, degrees), Christian expressions (oh my God, Jesus, damn, hell — unless they fit this world), weekday and month names, and anachronistic objects and concepts. Give every one an in-world replacement. Format: `- word → replacement`. Include idioms, not only single words.';
    }
    return 'This roleplay is written in RUSSIAN, and models writing fantasy in Russian keep slipping into words that belong to OUR world: Russian peasant and folk vocabulary (изба, барин, щи, сарафан, батюшка as an address) unless the setting is Slavic; Orthodox Christian expressions (Господи, ей-богу, слава богу, с богом, чёрт, ад); Soviet and bureaucratic phrasing; modern colloquialisms and office, tech and psychology jargon (окей, супер, минутка, адреналин, стресс, шок, на автомате, нервы); Earth units (секунда, минута, час as a precise unit, метр, километр, градус, верста, рубль, копейка); weekday names (воскресенье, суббота); anachronistic objects and concepts. List at least 30 such words and phrases that are LIKELY to appear in THIS particular setting and give every one an in-world replacement. Format: `- слово → замена`. Include idioms and set phrases, not only single words. Every line must have a replacement — no bare bans.';
}

export const MODULES = [
    {
        id: 'daily',
        label: 'Быт и технологии',
        prompt: 'DAILY LIFE & TECHNOLOGY — what exists and what does not: lighting, heating, water, transport, medicine, sending word over distance, writing materials, common materials and tools. State notable absences explicitly (e.g. no clocks, no gunpowder, no printing) when they apply.',
    },
    {
        id: 'time',
        label: 'Время, меры, деньги',
        prompt: 'TIME, MEASURES, MONEY — how time is told (parts of the day, watches, bells, candle or incense lengths), the calendar (days, months, seasons, holidays with in-world names), units of distance, weight and volume, the currency with its denominations and rough prices of everyday things.',
    },
    {
        id: 'address',
        label: 'Обращения и этикет',
        prompt: 'FORMS OF ADDRESS & ETIQUETTE — how people address rulers, nobles, superiors, equals, servants, spouses, lovers, elders and children; titles and honorifics; bows, gestures and taboos of politeness. Give the actual words to use.',
    },
    {
        id: 'oaths',
        label: 'Клятвы, ругань, божества',
        prompt: 'OATHS, CURSES, DEITIES — who people swear by, everyday exclamations, curses and blessings, greetings and farewells. Give the actual phrases, ready to drop into dialogue.',
    },
    {
        id: 'lexicon',
        label: 'Словарь мира',
        prompt: 'WORLD VOCABULARY — in-world terms from the sources plus fitting new ones: places, institutions, ranks, creatures, foods, objects. Word + a very short gloss.',
    },
    {
        id: 'food',
        label: 'Еда и одежда',
        prompt: 'FOOD & CLOTHING — staple foods, drinks and dishes of different classes, and what is NOT eaten here (crops this world does not have); garments, fabrics, colours and accessories by class and gender.',
    },
    {
        id: 'blacklist',
        label: 'Чёрный список с заменами',
        prompt: (language) => `BLACKLIST WITH REPLACEMENTS — ${blacklistInstruction(language)}`,
    },
];

export function defaultModules() {
    return Object.fromEntries(MODULES.map((m) => [m.id, true]));
}

export function getModules(pkg) {
    return { ...defaultModules(), ...(pkg?.modules || {}) };
}

// ---------------------------------------------------------------------------
// Общие правила (system) — редактируются в настройках расширения
// ---------------------------------------------------------------------------

export const DEFAULT_INSTRUCTIONS = `You are a worldbuilding consultant for a long-form fantasy roleplay. Your job is to write a WORLD TEXTURE PACKAGE: a dense reference of concrete, everyday details that keeps the prose grounded in this particular world and stops words and concepts from our world from leaking into it.

How to work:
- Treat everything the source material (character card, persona, lorebooks) establishes as canon. Never contradict it.
- Where the sources are silent, invent details that fit the setting parameters. Invented details must feel native to this world, not borrowed from ours.
- Texture only: no plot, no retelling of the card, no character biographies, no advice on how to roleplay.
- Every line must carry something concrete: a name, a word, a measure, an object, a custom. No filler like "the world is full of mystery".
- Bullet points, one fact per line, a short header per section. No paragraphs of prose.
- Never name real-world countries, religions, historical figures or brands inside the package, even when a real-world analogue is given: borrow its texture, never its names.
- No preface, no closing remarks, no explanation of what the package is.`;

export function getInstructions() {
    const custom = String(getSettings().promptTemplate || '').trim();
    return custom || DEFAULT_INSTRUCTIONS;
}

// ---------------------------------------------------------------------------
// Сборка промта
// ---------------------------------------------------------------------------

function paramLine(param, params) {
    const value = params[param.id];
    if (param.id === 'archetype' && value === 'custom') {
        const custom = String(params.archetypeCustom || '').trim();
        if (custom) return `- ${param.promptLabel}: ${custom}`;
    }
    const option = param.options.find((o) => o.id === value);
    if (!option?.prompt) return `- ${param.promptLabel}: decide from the source material`;
    return `- ${param.promptLabel}: ${option.prompt}`;
}

/** Есть ли хоть один включённый модуль. */
export function hasEnabledModules(pkg) {
    return Object.values(getModules(pkg)).some(Boolean);
}

/**
 * Собирает сообщения для модели.
 * sourcesText — готовый текст источников из collectSources().
 */
export function buildMessages(pkg, sourcesText) {
    const params = getParams(pkg);
    const modules = getModules(pkg);
    const language = params.language === 'en' ? 'en' : 'ru';
    const languageName = language === 'en' ? 'English' : 'Russian';

    const lines = [];

    // Источники — первыми: длинный материал лучше работает в начале, а задача в конце.
    lines.push('# SOURCE MATERIAL', '', sourcesText.trim(), '');

    lines.push('# SETTING PARAMETERS');
    for (const param of PARAMS) lines.push(paramLine(param, params));
    lines.push(`- Roleplay language: ${languageName}`);
    const analogue = String(params.analogue || '').trim();
    if (analogue) {
        lines.push(`- Real-world analogue for texture only (borrow everyday texture, never its names, places, religions or people): ${analogue}`);
    }
    const wishes = String(params.wishes || '').trim();
    if (wishes) {
        lines.push(`- Author's wishes (binding; they override everything above): ${wishes}`);
    }
    lines.push('');

    lines.push('# SECTIONS TO WRITE (in this order)');
    let n = 0;
    for (const module of MODULES) {
        if (!modules[module.id]) continue;
        n++;
        const text = typeof module.prompt === 'function' ? module.prompt(language) : module.prompt;
        lines.push(`${n}. ${text}`);
    }
    lines.push('');

    lines.push('# LANGUAGE');
    lines.push(`Write everything inside <full> and <cheat> in ${languageName}, section headers included. Keep in-world names exactly as the sources spell them.`);
    lines.push('');

    lines.push('# OUTPUT FORMAT');
    lines.push('Reply with exactly two blocks and nothing outside them:');
    lines.push('<full>');
    lines.push('…the package: one "## " header per section above, bullet points under each…');
    lines.push('</full>');
    lines.push('<cheat>');
    lines.push('…the cheat sheet…');
    lines.push('</cheat>');
    lines.push('');
    lines.push('<full> is the main reference. Dense rather than long: roughly 800–1500 words.');
    lines.push('<cheat> sits right next to the latest messages in EVERY request, so keep it tight: at most ~25 lines. Only the replacement pairs most likely to slip (`- X → Y`) and the in-world units of time, distance and money. No headers, no explanations.');

    return [
        { role: 'system', content: getInstructions() },
        { role: 'user', content: lines.join('\n') },
    ];
}
