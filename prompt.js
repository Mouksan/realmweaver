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

// Мат — не русизм: он про тело и эмоции, а не про нашу веру или историю,
// и одинаково уместен в любом мире. Замены нужны только ругани, привязанной
// к нашей религии и фольклору.
const PROFANITY_RULE = {
    ru: 'IMPORTANT: obscene and coarse profanity (мат: блять, пиздец, хуй, сука, ебать and the like) is NOT foreign to any world — it is about bodies and emotions, not about our religion or history. Never blacklist it and never offer replacements for it. Only curses tied to OUR religion and folklore (Господи, чёрт, ад, к дьяволу, ей-богу) get in-world replacements.',
    en: 'IMPORTANT: obscene and coarse profanity (fuck, shit, bastard and the like) is NOT foreign to any world — it is about bodies and emotions, not about our religion or history. Never blacklist it and never offer replacements for it. Only curses tied to OUR religion (oh my God, Jesus, for Christ\'s sake, go to hell, damn you) get in-world replacements.',
};

// Примеры в скобках — это категории, а не чек-лист: иначе модель
// переписывает их подряд («психолог», «файл»), даже если в этом мире их
// никто и не ляпнет.
const EXAMPLES_RULE = {
    ru: 'The words in brackets above only illustrate the categories — they are NOT a checklist. Include an example only if it could genuinely slip into THIS setting, and spend most of the list on traps specific to this world: its genre, species, social order and magic (for instance, modern terms the genre tends to drag in).',
    en: 'The words in brackets above only illustrate the categories — they are NOT a checklist. Include an example only if it could genuinely slip into THIS setting, and spend most of the list on traps specific to this world: its genre, species, social order and magic (for instance, modern terms the genre tends to drag in).',
};

/**
 * Инструкция чёрного списка. Земные единицы времени и расстояния в неё
 * попадают, только если включён модуль «Время, меры, деньги»: выключила
 * модуль — минуты и часы остаются как есть.
 */
function blacklistInstruction(language, modules) {
    const replaceUnits = Boolean(modules?.time);
    if (language === 'en') {
        const units = replaceUnits
            ? 'Earth units (seconds, minutes, hours as precise units, miles, meters, degrees), '
            : '';
        const unitsNote = replaceUnits
            ? ''
            : ' Ordinary time and distance units (seconds, minutes, hours, miles) are acceptable in this roleplay — do not blacklist them.';
        return 'This roleplay is written in ENGLISH. List about 25–30 words and phrases from OUR world that a model is likely to slip into THIS setting — modern idioms and slang (okay, deadline, adrenaline, stressed out, on autopilot), technical, office and psychology jargon, '
            + units
            + 'Christian expressions (oh my God, Jesus, for Christ\'s sake — unless they fit this world), weekday and month names, and anachronistic objects and concepts. Give every one an in-world replacement. Format: `word → replacement`. Include idioms, not only single words. Both sides of every pair are in English. ' + EXAMPLES_RULE.en
            + ' ' + [unitsNote.trim(), PROFANITY_RULE.en].filter(Boolean).join(' ');
    }
    const units = replaceUnits
        ? 'Earth units (секунда, минута, минутка, час as a precise unit, метр, километр, градус, верста); '
        : '';
    const unitsNote = replaceUnits
        ? ''
        : ' Ordinary time and distance units (секунда, минута, час, метр, километр) are acceptable in this roleplay — do not blacklist them.';
    return 'This roleplay is written in RUSSIAN, and models writing fantasy in Russian keep slipping into words that belong to OUR world: Russian peasant, folk and old Russian military vocabulary (изба, барин, щи, сарафан, батюшка as an address) unless the setting is Slavic; Orthodox Christian expressions (Господи, ей-богу, слава богу, с богом, чёрт, ад); Soviet and bureaucratic phrasing; modern colloquialisms and office, tech and psychology jargon (окей, супер, адреналин, стресс, шок, на автомате); '
        + units
        + 'our money (рубль, копейка); weekday names (воскресенье, суббота); anachronistic objects and concepts. List about 25–30 such words and phrases that are LIKELY to appear in THIS particular setting and give every one an in-world replacement. Format: `слово → замена`. Include idioms and set phrases, not only single words. Every pair must have a replacement — no bare bans. Both sides of every pair are in Russian: no English or other foreign words (nobody types «deadline» in a Russian roleplay). ' + EXAMPLES_RULE.ru
        + ' ' + [unitsNote.trim(), PROFANITY_RULE.ru].filter(Boolean).join(' ');
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
        prompt: 'TIME, MEASURES, MONEY — how time is told (parts of the day, watches, bells, candle or incense lengths), the calendar (days, months, seasons, holidays with in-world names), units of distance, weight and volume, the currency with its denominations and rough prices of everyday things. Define every unit ONLY through in-world references (paces, cups, a day\'s ride, how much a porter carries) — never through our units and never "about N of our…".',
    },
    {
        id: 'address',
        label: 'Обращения и этикет',
        prompt: 'FORMS OF ADDRESS & ETIQUETTE — how people address rulers, nobles, superiors, equals, servants, spouses, lovers, elders and children; titles and honorifics; bows, gestures and taboos of politeness. Give the actual words to use.',
    },
    {
        id: 'oaths',
        label: 'Клятвы, ругань, божества',
        prompt: 'OATHS, CURSES, DEITIES — who people swear by, everyday exclamations, curses and blessings, greetings and farewells. Give the actual phrases, ready to drop into dialogue. In-world oaths ADD flavour; they never replace ordinary profanity, which stays available in every scene.',
    },
    {
        id: 'lexicon',
        label: 'Словарь мира',
        prompt: 'WORLD VOCABULARY — words of the world, not of the story: places and regions, institutions, ranks, peoples and species, plants and materials, objects. Word + a very short gloss. NO characters, NO named animals, NO events, NO plot — those live in the lorebook already. At most ~15 entries.',
    },
    {
        id: 'food',
        label: 'Еда и одежда',
        prompt: 'FOOD & CLOTHING — staple foods, drinks and dishes of different classes, and what is NOT eaten here (crops this world does not have); garments, fabrics, colours and accessories by class and gender.',
    },
    {
        id: 'blacklist',
        label: 'Чёрный список с заменами',
        prompt: (language, modules) => `BLACKLIST WITH REPLACEMENTS — ${blacklistInstruction(language, modules)}`,
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

// Звучание выдуманных имён — под архетип. Кириллицей, но нездешнее: если
// просить модель «придумывать по-русски», она лезет в славянские корни и
// церковную лексику (Студень, Заутреня) — ровно те русизмы, с которыми боремся.
const NAME_SOUND = {
    western: { ru: 'Latin- and Romance-sounding (e.g. Ренатис, Солмарис)', en: 'Latin- and Romance-sounding (e.g. Renatis, Solmaris)' },
    xianxia: { ru: 'Chinese-sounding, in the standard Russian (Palladius) transliteration', en: 'Chinese-sounding, in pinyin' },
    eastern_court: { ru: 'Japanese- or Korean-sounding, in the standard Russian transliteration', en: 'Japanese- or Korean-sounding' },
    middle_eastern: { ru: 'Arabic- or Persian-sounding', en: 'Arabic- or Persian-sounding' },
    slavic: { ru: 'Slavic-sounding — Slavic roots are native in this setting', en: 'Slavic-sounding — Slavic roots are native in this setting' },
    steampunk: { ru: 'Latin-, Romance- or Germanic-sounding', en: 'Latin-, Romance- or Germanic-sounding' },
};

function nameSoundLine(params, language) {
    const preset = NAME_SOUND[params.archetype];
    if (preset) return preset[language];
    return language === 'en'
        ? 'matching the culture that the setting parameters and the sources suggest'
        : 'matching the culture that the setting parameters and the sources suggest — never Slavic unless the setting is Slavic';
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
        const text = typeof module.prompt === 'function' ? module.prompt(language, modules) : module.prompt;
        lines.push(`${n}. ${text}`);
    }
    lines.push('');

    const slavic = params.archetype === 'slavic';
    lines.push('# LANGUAGE AND NAMES');
    lines.push(`Write everything inside <full> and <cheat> in ${languageName}, section headers included.`);
    if (language === 'ru') {
        if (slavic) {
            lines.push('- Names and coined terms (places, months, holidays, units, coins, ranks, deities) are written in Cyrillic and sound Slavic — Slavic roots are native in this setting. Names taken from the sources are transliterated into Cyrillic as they sound.');
            lines.push('- Never borrow church or liturgical vocabulary (заутреня, вечерня, повечерие, постный день, воскресение) — this world has its own faith.');
        } else {
            lines.push(`- Names and coined terms (places, months, holidays, units, coins, ranks, deities) are written in Cyrillic but must sound foreign to Russian ears: ${nameSoundLine(params, language)}. Names taken from the sources are transliterated into Cyrillic as they sound.`);
            lines.push('- Never coin words from Slavic roots (no Студень, Травник, Ледогон-style names) and never borrow church or liturgical vocabulary (заутреня, вечерня, повечерие, постный день, воскресение).');
        }
        lines.push('- Plain everyday Russian words for ordinary things (хлеб, свеча, колокол, плащ) are fine — the foreign sound is for names and coined terms.');
    } else {
        lines.push(`- Names and coined terms (places, months, holidays, units, coins, ranks, deities) must sound foreign: ${nameSoundLine(params, language)}. Names taken from the sources keep their spelling.`);
        lines.push('- Never borrow church or liturgical vocabulary (matins, vespers, compline, Sabbath, Lent) for in-world time or customs.');
    }
    lines.push('- Never add original-language glosses in parentheses — not for names, not for terms, not for phrases.');
    lines.push('');

    lines.push('# WORLD CONSISTENCY');
    lines.push('- Concepts may resemble our pre-modern practice (bells, candles, night watches, market days); only the WORDS must not be ours.');
    lines.push('- Never measure anything in our units and never compare with them: no centimetres, metres, grams, kilograms, litres, no "about a hundred of our grams" or "half of our hour". Define every in-world unit through other in-world things (e.g. "a thousand paces", "as much as a man drinks at one go").');
    lines.push(language === 'ru'
        ? '- The words «наш», «наша», «наши», «наших» must not appear in the package at all when they refer to our world.'
        : '- The phrase "our world" and comparisons like "our hour", "our mile" must not appear in the package at all.');
    lines.push('- Holidays, customs and institutions may take a theme from our world, but never its name: give them native in-world names. If the sources already name something, use that name.');
    lines.push('- No meta-commentary inside the package (no "possibly a typo in the source", no notes to the author).');
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
    lines.push('SIZE LIMITS — they are strict:');
    // Модели не умеют считать свои токены и стабильно перебирают планку
    // примерно в полтора раза — поэтому просим ~2000, чтобы приземлялось около 3000.
    lines.push(`- <full>: about 2,000 tokens in total (${language === 'ru' ? 'roughly 700–800 Russian words' : 'roughly 1,400 English words'}). Density over length.`);
    lines.push('- Every section: at most ~10 bullet lines. Each line is a topic label plus 3–6 related items separated by semicolons (e.g. `- Lighting: …; …; …`). No one-word or two-word lines, no bold sub-headers inside sections.');
    lines.push('- The blacklist: at most ~30 pairs in total, grouped by kind, 3–5 pairs per line separated by semicolons (e.g. `- Faith: Господи → …; ей-богу → …; слава богу → …`).');
    const cheatUnits = modules.time ? ' and the in-world units of time, distance and money' : '';
    lines.push(`<cheat> sits right next to the latest messages in EVERY request, so keep it tight: at most ~12 lines, 2–4 pairs per line separated by semicolons. Only the replacement pairs most likely to slip (\`X → Y\`)${cheatUnits}. Never put profanity into the replacement pairs. No headers, no explanations.`);

    return [
        { role: 'system', content: getInstructions() },
        { role: 'user', content: lines.join('\n') },
    ];
}
