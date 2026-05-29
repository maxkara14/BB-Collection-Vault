/* global jQuery, SillyTavern, toastr */
import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'BB-Collection-Vault';
const META_KEY = 'bb_collection_vault';
const PROMPT_KEY = 'bb_collection_vault_achievement_prompt';

const ORB_BLOCK_REGEX = /::(?:SILVER|LORE)_ORB_START::\s*([\s\S]*?)\s*::(?:SILVER|LORE)_ORB_END::/gi;
const ACHIEVEMENT_REGEX = /\[ACHIEVEMENT:\s*([^|\]\n]{1,16})\s*\|\s*([^|\]\n]{1,96})\s*\|\s*([^|\]\n]{1,220})\s*\|\s*(common|rare|epic|legendary)\s*\]/gi;
const ACHIEVEMENT_HIDE_REGEX = /\[ACHIEVEMENT:[^\]]*\]/gi;

const DEFAULT_ACHIEVEMENT_PROMPT_VERSION = 2;
const DEFAULT_ACHIEVEMENT_PROMPT_V1 = `<bb_collection_vault_achievements>
В конце своего ответа ты МОЖЕШЬ выдать одну ачивку пользователю, но только если в сцене произошло действительно значимое событие.

Подходящие поводы:
- сильный эмоциональный пик, катарсис или болезненное признание;
- важное сюжетное решение или раскрытие правды;
- смелый, смешной, абсурдный или очень характерный поступок пользователя;
- мастерская реплика пользователя, которая меняет тон сцены;
- крупный провал, победа, риск или момент, который захочется помнить.

Не выдавай ачивки за обычный обмен репликами, бытовой переход, описание окружения или каждое сообщение подряд.
Минимальная дистанция между ачивками: примерно {{cooldown}} сообщений.

Формат строго одной отдельной строкой в самом конце ответа:
[ACHIEVEMENT: эмодзи | Название | Краткое описание одним предложением | редкость]

Редкости: common, rare, epic, legendary.
Название короткое, в стиле Steam, 3-6 слов. Эмодзи один. Не упоминай ачивку в обычном тексте ответа.
</bb_collection_vault_achievements>`;

const DEFAULT_ACHIEVEMENT_PROMPT = `<bb_collection_vault_achievements>
В конце своего ответа выдай одну ачивку пользователю, если текущий ответ закрепляет действительно запоминающийся момент сцены.

Не жди финала арки. Если прямо сейчас произошел сильный поворот, риск, победа, провал, признание, раскрытие правды, эмоциональный пик, очень характерный поступок пользователя или реплика, которая заметно меняет тон сцены, ачивка уместна.

Ориентир частоты:
- в спокойной бытовой сцене ачивку можно не выдавать;
- в динамичной сцене, если кулдаун прошел, нормальна примерно одна ачивка на 3-6 ответов;
- не выдавай ачивки за обычный обмен репликами, простое описание окружения, технический переход или каждое сообщение подряд.

Минимальная дистанция между ачивками: примерно {{cooldown}} сообщений.
С момента последней сохраненной чат-ачивки прошло: {{since_last}} сообщений.

Формат строго одной отдельной строкой в самом конце ответа:
[ACHIEVEMENT: эмодзи | Название | Краткое описание одним предложением | редкость]

Редкости строго на английском: common, rare, epic, legendary.
Название короткое, в стиле Steam, 3-6 слов. Эмодзи один. Не упоминай ачивку в обычном тексте ответа.
</bb_collection_vault_achievements>`;

const DEFAULT_NEGATIVE_PROMPT = `<bb_collection_vault_achievements>
Не выдавай ачивку в этом ответе. Кулдаун еще не прошел: осталось {{remaining}} сообщений.
Не добавляй маркер [ACHIEVEMENT: ...].
</bb_collection_vault_achievements>`;

const DEFAULT_SETTINGS = {
    enabled: true,
    collectOrbs: true,
    achievementsEnabled: true,
    injectAchievementPrompt: true,
    achievementPrompt: DEFAULT_ACHIEVEMENT_PROMPT,
    achievementPromptVersion: DEFAULT_ACHIEVEMENT_PROMPT_VERSION,
    negativeAchievementPrompt: DEFAULT_NEGATIVE_PROMPT,
    achievementCooldown: 8,
    enforceAchievementCooldown: true,
    injectPosition: extension_prompt_types.IN_CHAT,
    injectDepth: 4,
    injectRole: extension_prompt_roles.SYSTEM,
    showFloatingButton: true,
    showOrbToasts: true,
    showAchievementToasts: true,
    orbToastRarities: ['Rare', 'Anomaly'],
    dedupeAchievements: true,
    appearanceTheme: 'midnight',
    accentColor: '#8fdcff',
    panelDensity: 'cozy',
    toastCorner: 'top_right',
    toastScale: 100,
    toastUseCustomColors: false,
    toastBgColor: '#0d1119',
    toastTextColor: '#eef8ff',
    toastAccentColor: '#8fdcff',
    soundEnabled: true,
    soundVolume: 45,
    soundOnAchievements: true,
    soundOnOrbs: true,
    debugVerbose: false,
    fabX: null,
    fabY: null,
};

const ORB_RARITIES = ['Common', 'Uncommon', 'Rare', 'Anomaly'];
const ACHIEVEMENT_RARITIES = ['common', 'rare', 'epic', 'legendary'];
const APPEARANCE_THEMES = ['midnight', 'glass', 'ember', 'mono'];
const PANEL_DENSITIES = ['compact', 'cozy', 'wide'];
const TOAST_CORNERS = ['top_right', 'top_left', 'bottom_right', 'bottom_left'];
const FAB_VIEWPORT_MARGIN = 8;

const MILESTONES = [
    {
        id: 'vault_first_orb',
        emoji: '🔮',
        title: 'Первый отголосок',
        description: 'В коллекции появился первый лор-орб.',
        rarity: 'common',
        when: (stats) => stats.orbs >= 1,
    },
    {
        id: 'vault_ten_orbs',
        emoji: '✨',
        title: 'Малый архивариус',
        description: 'Собрано десять лор-орбов в одном чате.',
        rarity: 'rare',
        when: (stats) => stats.orbs >= 10,
    },
    {
        id: 'vault_first_rare',
        emoji: '💎',
        title: 'Редкий отблеск',
        description: 'В коллекции найден первый редкий орб.',
        rarity: 'rare',
        when: (stats) => stats.rare >= 1,
    },
    {
        id: 'vault_first_anomaly',
        emoji: '🜁',
        title: 'Нечто смотрит обратно',
        description: 'В коллекции появилась первая аномалия.',
        rarity: 'epic',
        when: (stats) => stats.anomaly >= 1,
    },
    {
        id: 'vault_all_fragment_types',
        emoji: '📜',
        title: 'Полка фрагментов',
        description: 'Собрано пять разных типов лор-фрагментов.',
        rarity: 'rare',
        when: (stats) => stats.fragmentTypes >= 5,
    },
];

const uiState = {
    activeTab: 'orbs',
    selectedOrbHash: '',
    search: '',
    rarityFilter: 'all',
};

const settingsUiState = {
    activeTab: 'collection',
};

let scanTimer = null;
let scanShouldNotify = false;
let scanNotifyUntil = 0;
let hideTimer = null;
let observer = null;
let hideObserverPaused = false;
let fabDrag = null;
let audioContext = null;

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = extension_settings[MODULE_NAME];
    const hadAchievementPromptVersion = settings.achievementPromptVersion !== undefined;
    const storedAchievementPromptVersion = hadAchievementPromptVersion
        ? Number(settings.achievementPromptVersion)
        : 1;
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(value);
        }
    }
    if (!Array.isArray(settings.orbToastRarities)) {
        settings.orbToastRarities = ['Rare', 'Anomaly'];
    }
    if (!APPEARANCE_THEMES.includes(String(settings.appearanceTheme))) {
        settings.appearanceTheme = DEFAULT_SETTINGS.appearanceTheme;
    }
    if (!PANEL_DENSITIES.includes(String(settings.panelDensity))) {
        settings.panelDensity = DEFAULT_SETTINGS.panelDensity;
    }
    if (!TOAST_CORNERS.includes(String(settings.toastCorner))) {
        settings.toastCorner = DEFAULT_SETTINGS.toastCorner;
    }
    settings.achievementCooldown = Math.max(1, Number(settings.achievementCooldown) || DEFAULT_SETTINGS.achievementCooldown);
    settings.injectDepth = Math.max(0, Number(settings.injectDepth) || 0);
    settings.injectRole = Number(settings.injectRole ?? extension_prompt_roles.SYSTEM);
    settings.injectPosition = Number(settings.injectPosition ?? extension_prompt_types.IN_CHAT);
    settings.toastScale = Math.min(130, Math.max(80, Number(settings.toastScale) || DEFAULT_SETTINGS.toastScale));
    settings.accentColor = normalizeHex(settings.accentColor, DEFAULT_SETTINGS.accentColor);
    settings.toastBgColor = normalizeHex(settings.toastBgColor, DEFAULT_SETTINGS.toastBgColor);
    settings.toastTextColor = normalizeHex(settings.toastTextColor, DEFAULT_SETTINGS.toastTextColor);
    settings.toastAccentColor = normalizeHex(settings.toastAccentColor, DEFAULT_SETTINGS.toastAccentColor);
    const soundVolume = Number(settings.soundVolume);
    settings.soundVolume = Number.isFinite(soundVolume)
        ? Math.min(100, Math.max(0, soundVolume))
        : DEFAULT_SETTINGS.soundVolume;
    if (!settings.achievementPrompt) settings.achievementPrompt = DEFAULT_ACHIEVEMENT_PROMPT;
    if (storedAchievementPromptVersion < DEFAULT_ACHIEVEMENT_PROMPT_VERSION
        && normalizeText(settings.achievementPrompt) === normalizeText(DEFAULT_ACHIEVEMENT_PROMPT_V1)) {
        settings.achievementPrompt = DEFAULT_ACHIEVEMENT_PROMPT;
    }
    settings.achievementPromptVersion = DEFAULT_ACHIEVEMENT_PROMPT_VERSION;
    if (!settings.negativeAchievementPrompt) settings.negativeAchievementPrompt = DEFAULT_NEGATIVE_PROMPT;
    return settings;
}

function saveSettings() {
    saveSettingsDebounced();
}

function getContext() {
    try {
        return SillyTavern.getContext();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to get SillyTavern context`, error);
        return null;
    }
}

function ensureStore() {
    const context = getContext();
    if (!context) return null;
    if (!context.chatMetadata) context.chatMetadata = {};
    if (!context.chatMetadata[META_KEY]) {
        context.chatMetadata[META_KEY] = {
            version: 1,
            orbs: [],
            achievements: [],
            achievementSources: [],
            ignoredOrbHashes: [],
            ignoredAchievementHashes: [],
        };
    }
    const store = context.chatMetadata[META_KEY];
    if (!Array.isArray(store.orbs)) store.orbs = [];
    if (!Array.isArray(store.achievements)) store.achievements = [];
    if (!Array.isArray(store.achievementSources)) store.achievementSources = [];
    if (!Array.isArray(store.ignoredOrbHashes)) store.ignoredOrbHashes = [];
    if (!Array.isArray(store.ignoredAchievementHashes)) store.ignoredAchievementHashes = [];
    return store;
}

function persistChat() {
    const context = getContext();
    if (typeof context?.saveChat === 'function') {
        context.saveChat();
    }
}

function normalizeText(value) {
    return String(value ?? '').replace(/\r/g, '').replace(/\s+\n/g, '\n').trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hashString(value) {
    const text = String(value ?? '');
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

function normalizeHex(value, fallback = '#8fdcff') {
    const safe = String(value || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(safe)) return safe;
    return fallback;
}

function normalizeOrbRarity(value) {
    const raw = normalizeText(value).toLowerCase();
    const found = ORB_RARITIES.find((rarity) => rarity.toLowerCase() === raw);
    return found || 'Common';
}

function normalizeAchievementRarity(value) {
    const raw = normalizeText(value).toLowerCase();
    return ACHIEVEMENT_RARITIES.includes(raw) ? raw : 'common';
}

function getMessageTimestamp(message, index) {
    const sendDate = typeof message?.send_date === 'string'
        ? Date.parse(message.send_date)
        : Number(message?.send_date || 0);
    if (Number.isFinite(sendDate) && sendDate > 0) return sendDate;
    const genStarted = Number(message?.gen_started || 0);
    if (Number.isFinite(genStarted) && genStarted > 0) return genStarted;
    return Date.now() + index;
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    try {
        return new Date(timestamp).toLocaleString();
    } catch {
        return '';
    }
}

function getThemeVars(settings = getSettings()) {
    const themes = {
        midnight: {
            bg: '#0d1119',
            surface: '#151c2a',
            border: 'rgba(143, 220, 255, 0.28)',
            text: '#eef8ff',
            muted: 'rgba(238, 248, 255, 0.72)',
        },
        glass: {
            bg: 'rgba(19, 25, 34, 0.88)',
            surface: 'rgba(255, 255, 255, 0.075)',
            border: 'rgba(210, 235, 255, 0.24)',
            text: '#f5fbff',
            muted: 'rgba(245, 251, 255, 0.7)',
        },
        ember: {
            bg: '#17110f',
            surface: '#241918',
            border: 'rgba(255, 178, 120, 0.28)',
            text: '#fff4ec',
            muted: 'rgba(255, 244, 236, 0.7)',
        },
        mono: {
            bg: '#101010',
            surface: '#1a1a1a',
            border: 'rgba(255, 255, 255, 0.22)',
            text: '#f4f4f4',
            muted: 'rgba(244, 244, 244, 0.66)',
        },
    };
    return themes[settings.appearanceTheme] || themes.midnight;
}

function applyAppearance() {
    const settings = getSettings();
    const theme = getThemeVars(settings);
    const roots = [
        document.getElementById('bbcv-settings'),
        document.getElementById('bbcv-panel'),
        document.getElementById('bbcv-fab'),
        document.getElementById('bbcv-toast-container'),
    ].filter(Boolean);

    for (const root of roots) {
        const isToastRoot = root.id === 'bbcv-toast-container';
        const customToast = isToastRoot && settings.toastUseCustomColors;
        const bg = customToast ? settings.toastBgColor : theme.bg;
        const text = customToast ? settings.toastTextColor : theme.text;
        const accent = customToast ? settings.toastAccentColor : settings.accentColor;
        const border = customToast
            ? `color-mix(in srgb, ${settings.toastAccentColor} 42%, transparent)`
            : theme.border;
        root.style.setProperty('--bbcv-accent', accent);
        root.style.setProperty('--bbcv-toast-accent', accent);
        root.style.setProperty('--bbcv-bg', bg);
        root.style.setProperty('--bbcv-surface', theme.surface);
        root.style.setProperty('--bbcv-border', border);
        root.style.setProperty('--bbcv-text', text);
        root.style.setProperty('--bbcv-muted', theme.muted);
        root.style.setProperty('--bbcv-toast-scale', String(settings.toastScale / 100));
        root.classList.toggle('bbcv-density-compact', settings.panelDensity === 'compact');
        root.classList.toggle('bbcv-density-wide', settings.panelDensity === 'wide');
        root.classList.toggle('bbcv-theme-glass', settings.appearanceTheme === 'glass');
        root.classList.toggle('bbcv-theme-ember', settings.appearanceTheme === 'ember');
        root.classList.toggle('bbcv-theme-mono', settings.appearanceTheme === 'mono');
    }
}

function parseKeyedOrbBlock(body) {
    const raw = String(body || '').replace(/\r/g, '').trim();
    if (!raw) return null;

    const textMatch = raw.match(/(?:^|\n)(?:Text|\u0422\u0435\u043a\u0441\u0442):\s*([\s\S]*)$/i);
    let header = textMatch ? raw.slice(0, textMatch.index).trim() : raw;
    let text = textMatch ? normalizeText(textMatch[1]) : '';
    if (!textMatch) {
        const knownFields = new Set([
            'orb_id',
            'aura_source',
            'character',
            'palette_a',
            'palette_b',
            'palette_glow',
            'rarity',
            'fragment_type',
            'fragment_length',
            'title',
        ]);
        const lines = raw.split('\n');
        let lastFieldIndex = -1;
        for (let i = 0; i < lines.length; i += 1) {
            const match = lines[i].match(/^([A-Za-z\u0410-\u042f\u0430-\u044f\u0401\u04510-9_ /-]{1,40}):\s*(.*)$/);
            if (match && knownFields.has(match[1].trim().toLowerCase())) {
                lastFieldIndex = i;
            }
        }
        if (lastFieldIndex >= 0 && lastFieldIndex < lines.length - 1) {
            header = lines.slice(0, lastFieldIndex + 1).join('\n').trim();
            text = normalizeText(lines.slice(lastFieldIndex + 1).join('\n'));
        }
    }
    const fields = {};

    for (const line of header.split('\n')) {
        const match = line.match(/^([A-Za-zА-Яа-яЁё0-9_ /-]{1,40}):\s*(.*)$/);
        if (!match) continue;
        fields[match[1].trim().toLowerCase()] = normalizeText(match[2]);
    }

    const title = fields.title || 'Безымянный отголосок';
    const source = fields.aura_source || fields.character || 'Неизвестный источник';

    return {
        orbId: fields.orb_id || '',
        source,
        paletteA: normalizeHex(fields.palette_a, '#6f8cff'),
        paletteB: normalizeHex(fields.palette_b, '#2f365f'),
        paletteGlow: normalizeHex(fields.palette_glow, '#bff8ff'),
        rarity: normalizeOrbRarity(fields.rarity),
        fragmentType: fields.fragment_type || 'Фрагмент',
        fragmentLength: fields.fragment_length || '',
        title,
        text: text || fields.fragment || '',
        raw,
    };
}

function parseOrbsFromMessage(message, messageIndex) {
    const text = String(message?.mes || message?.message || '');
    const results = [];
    ORB_BLOCK_REGEX.lastIndex = 0;
    for (const match of text.matchAll(ORB_BLOCK_REGEX)) {
        const parsed = parseKeyedOrbBlock(match[1]);
        if (!parsed) continue;
        const messageKey = getMessageStableKey(message, messageIndex);
        const contentHash = hashString([
            parsed.orbId,
            parsed.title,
            parsed.source,
            parsed.text,
            parsed.raw,
        ].join('|'));
        const signature = [messageKey, contentHash].join('|');
        const hash = hashString(signature);
        results.push({
            id: parsed.orbId || hash,
            hash,
            contentHash,
            messageKey,
            ...parsed,
            messageIndex,
            createdAt: getMessageTimestamp(message, messageIndex),
        });
    }
    return results;
}

function getMessageStableKey(message, messageIndex, swipeId = message?.swipe_id ?? 0) {
    const swipeInfo = Array.isArray(message?.swipe_info) ? message.swipe_info[Number(swipeId)] : null;
    const parts = [
        swipeInfo?.send_date || message?.send_date || '',
        swipeInfo?.gen_started || message?.gen_started || '',
        swipeInfo?.gen_finished || message?.gen_finished || '',
        message?.name || message?.original_name || '',
        swipeId,
    ].map((part) => String(part || '').trim());
    const key = parts.join('|');
    return key.replace(/\|/g, '') ? key : `message_${messageIndex}`;
}

function addExistingMessageKeys(targetSet, message, messageIndex) {
    targetSet.add(getMessageStableKey(message, messageIndex));
    if (!Array.isArray(message?.swipes)) return;
    for (let swipeIndex = 0; swipeIndex < message.swipes.length; swipeIndex += 1) {
        if (typeof message.swipes[swipeIndex] === 'string') {
            targetSet.add(getMessageStableKey(message, messageIndex, swipeIndex));
        }
    }
}

function getOrbContentHash(orb) {
    return orb?.contentHash || hashString([
        orb?.orbId || orb?.id || '',
        orb?.title || '',
        orb?.source || '',
        orb?.text || '',
        orb?.raw || '',
    ].join('|'));
}

function getOrbIdentityKeys(orb) {
    const keys = new Set();
    if (orb?.hash) keys.add(String(orb.hash));
    const contentHash = getOrbContentHash(orb);
    if (contentHash) keys.add(contentHash);
    if (orb?.messageKey && contentHash) {
        keys.add(hashString([orb.messageKey, contentHash].join('|')));
    }
    return keys;
}

function addOrbKeys(targetSet, orb) {
    for (const key of getOrbIdentityKeys(orb)) {
        targetSet.add(key);
    }
}

function hasKnownOrbKey(knownKeys, orb) {
    for (const key of getOrbIdentityKeys(orb)) {
        if (knownKeys.has(key)) return true;
    }
    return false;
}

function normalizeStoredOrbIdentity(orb) {
    if (!orb || typeof orb !== 'object') return orb;
    if (!orb.contentHash) orb.contentHash = getOrbContentHash(orb);
    return orb;
}

function pruneMissingOrbs(store, currentOrbKeys) {
    const removed = [];
    const kept = [];
    for (const orb of store.orbs) {
        normalizeStoredOrbIdentity(orb);
        if (hasKnownOrbKey(currentOrbKeys, orb)) {
            kept.push(orb);
        } else {
            removed.push(orb);
        }
    }
    if (removed.length) {
        store.orbs = kept;
    }
    return removed;
}

function parseAchievementsFromMessage(message, messageIndex) {
    const text = String(message?.mes || message?.message || '');
    const results = [];
    ACHIEVEMENT_REGEX.lastIndex = 0;
    for (const match of text.matchAll(ACHIEVEMENT_REGEX)) {
        const messageKey = getMessageStableKey(message, messageIndex);
        const sourceHash = hashString([messageKey, match[0]].join('|'));
        const achievement = {
            id: `chat_${sourceHash}`,
            hash: sourceHash,
            sourceHash,
            source: 'chat',
            emoji: normalizeText(match[1]) || '🏆',
            title: normalizeText(match[2]),
            description: normalizeText(match[3]),
            rarity: normalizeAchievementRarity(match[4]),
            raw: match[0],
            messageKey,
            messageLinked: true,
            messageIndex,
            createdAt: getMessageTimestamp(message, messageIndex),
        };
        if (achievement.title && achievement.description) {
            results.push(achievement);
        }
    }
    return results;
}

function stripAchievementMarkersFromText(text) {
    const original = String(text ?? '');
    if (!original.includes('[ACHIEVEMENT:')) return original;
    ACHIEVEMENT_HIDE_REGEX.lastIndex = 0;
    return original
        .replace(ACHIEVEMENT_HIDE_REGEX, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}

function stripAchievementMarkersFromMessage(message) {
    if (!message) return false;
    let changed = false;
    for (const key of ['mes', 'message']) {
        if (typeof message[key] !== 'string') continue;
        const next = stripAchievementMarkersFromText(message[key]);
        if (next !== message[key]) {
            message[key] = next;
            changed = true;
        }
    }
    const swipeIndex = Number(message.swipe_id);
    if (Array.isArray(message.swipes) && Number.isInteger(swipeIndex) && typeof message.swipes[swipeIndex] === 'string') {
        const next = stripAchievementMarkersFromText(message.swipes[swipeIndex]);
        if (next !== message.swipes[swipeIndex]) {
            message.swipes[swipeIndex] = next;
            changed = true;
        }
    }
    return changed;
}

function achievementContentKey(achievement) {
    return [
        normalizeAchievementDedupeText(achievement?.title),
        normalizeAchievementDedupeText(achievement?.description),
    ].join('|');
}

function normalizeAchievementDedupeText(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function achievementTitleKey(achievement) {
    return normalizeAchievementDedupeText(achievement?.title);
}

function getAchievementSourceHash(achievement) {
    if (achievement?.sourceHash) return String(achievement.sourceHash);
    if (achievement?.messageKey && achievement?.raw) {
        return hashString([achievement.messageKey, achievement.raw].join('|'));
    }
    if (achievement?.hash) return String(achievement.hash);
    if (achievement?.id) return String(achievement.id);
    return hashString([
        achievement?.messageKey || '',
        achievementContentKey(achievement),
    ].join('|'));
}

function achievementSourceFromAchievement(achievement) {
    const sourceHash = getAchievementSourceHash(achievement);
    return {
        sourceHash,
        hash: sourceHash,
        id: achievement.id || `chat_${sourceHash}`,
        source: 'chat',
        emoji: achievement.emoji || 'рџЏ†',
        title: achievement.title || '',
        description: achievement.description || '',
        rarity: normalizeAchievementRarity(achievement.rarity),
        raw: achievement.raw || '',
        messageKey: achievement.messageKey || '',
        messageLinked: true,
        messageIndex: achievement.messageIndex,
        createdAt: Number(achievement.createdAt || 0) || Date.now(),
    };
}

function achievementFromSource(source) {
    const sourceHash = getAchievementSourceHash(source);
    return {
        id: source.id || `chat_${sourceHash}`,
        hash: sourceHash,
        sourceHash,
        source: 'chat',
        emoji: source.emoji || 'рџЏ†',
        title: source.title || '',
        description: source.description || '',
        rarity: normalizeAchievementRarity(source.rarity),
        raw: source.raw || '',
        messageKey: source.messageKey || '',
        messageLinked: true,
        messageIndex: source.messageIndex,
        createdAt: Number(source.createdAt || 0) || Date.now(),
        restoredFromSource: !!source.restoredFromSource,
    };
}

function upsertAchievementSource(store, achievement) {
    if (!store || achievement?.source !== 'chat' || !achievement.messageKey) return false;
    const source = achievementSourceFromAchievement(achievement);
    const index = store.achievementSources.findIndex((item) => getAchievementSourceHash(item) === source.sourceHash);
    if (index >= 0) {
        store.achievementSources[index] = { ...store.achievementSources[index], ...source };
        return false;
    }
    store.achievementSources.push(source);
    return true;
}

function migrateAchievementSourcesFromAchievements(store) {
    if (!store) return 0;
    let changed = 0;
    for (const achievement of store.achievements) {
        if (achievement?.source !== 'chat' || !achievement.messageKey) continue;
        if (!achievement.title || !achievement.description) continue;
        const sourceHash = getAchievementSourceHash(achievement);
        if (achievement.sourceHash !== sourceHash) {
            achievement.sourceHash = sourceHash;
            changed += 1;
        }
        if (!achievement.hash) {
            achievement.hash = sourceHash;
            changed += 1;
        }
        if (achievement.messageLinked === undefined) {
            achievement.messageLinked = true;
            changed += 1;
        }
        if (upsertAchievementSource(store, achievement)) changed += 1;
    }
    return changed;
}

function pruneMissingAchievementSources(store, currentMessageKeys) {
    const removed = [];
    const kept = [];
    for (const source of store.achievementSources) {
        if (source?.messageKey && currentMessageKeys.has(String(source.messageKey))) {
            kept.push(source);
        } else {
            removed.push(source);
        }
    }
    if (removed.length) {
        store.achievementSources = kept;
    }
    return removed;
}

function getCurrentAchievementSources(store, currentMessageKeys) {
    return store.achievementSources
        .filter((source) => source?.messageKey && currentMessageKeys.has(String(source.messageKey)))
        .map((source) => achievementFromSource({ ...source, restoredFromSource: true }))
        .filter((achievement) => achievement.title && achievement.description);
}

function pruneMissingAchievements(store, currentSourceHashes) {
    const removed = [];
    const kept = [];
    for (const achievement of store.achievements) {
        if (achievement?.source !== 'chat') {
            kept.push(achievement);
            continue;
        }
        if (!achievement.messageKey) {
            kept.push(achievement);
            continue;
        }
        if (!achievement.sourceHash) {
            kept.push(achievement);
            continue;
        }
        const sourceHash = getAchievementSourceHash(achievement);
        if (currentSourceHashes.has(sourceHash)) {
            kept.push(achievement);
        } else {
            removed.push(achievement);
        }
    }
    if (removed.length) {
        store.achievements = kept;
    }
    return removed;
}

function getLastAcceptedChatAchievementIndex(store = ensureStore()) {
    const achievements = Array.isArray(store?.achievements) ? store.achievements : [];
    let lastIndex = -1;
    for (const achievement of achievements) {
        if (achievement?.source !== 'chat') continue;
        const index = Number(achievement.messageIndex);
        if (Number.isFinite(index)) lastIndex = Math.max(lastIndex, index);
    }
    return lastIndex;
}

function isAchievementBlockedByCooldown(messageIndex, lastAcceptedIndex, settings = getSettings()) {
    if (!settings.enforceAchievementCooldown) return false;
    if (!Number.isFinite(Number(messageIndex)) || lastAcceptedIndex < 0) return false;
    return (Number(messageIndex) - lastAcceptedIndex) < settings.achievementCooldown;
}

function getStats(store = ensureStore()) {
    const orbs = Array.isArray(store?.orbs) ? store.orbs : [];
    const fragmentTypes = new Set(orbs.map((orb) => normalizeText(orb.fragmentType).toLowerCase()).filter(Boolean));
    return {
        orbs: orbs.length,
        common: orbs.filter((orb) => orb.rarity === 'Common').length,
        uncommon: orbs.filter((orb) => orb.rarity === 'Uncommon').length,
        rare: orbs.filter((orb) => orb.rarity === 'Rare').length,
        anomaly: orbs.filter((orb) => orb.rarity === 'Anomaly').length,
        fragmentTypes: fragmentTypes.size,
        achievements: Array.isArray(store?.achievements) ? store.achievements.length : 0,
    };
}

function grantVaultAchievement(input, notify = false) {
    const settings = getSettings();
    const store = ensureStore();
    if (!store || !settings.achievementsEnabled) return false;
    if (store.achievements.some((item) => item.id === input.id)) return false;

    const achievement = {
        id: input.id,
        hash: input.id,
        source: 'vault',
        emoji: input.emoji || '🏆',
        title: input.title,
        description: input.description,
        rarity: normalizeAchievementRarity(input.rarity),
        messageIndex: null,
        createdAt: Date.now(),
    };
    store.achievements.push(achievement);
    persistChat();
    if (notify && settings.showAchievementToasts) {
        showAchievementToast(achievement);
    }
    return true;
}

function checkMilestones(notify = false) {
    const store = ensureStore();
    if (!store) return;
    const stats = getStats(store);
    for (const milestone of MILESTONES) {
        if (milestone.when(stats)) {
            grantVaultAchievement(milestone, notify);
        }
    }
}

function shouldNotifyOrb(orb) {
    const settings = getSettings();
    return settings.enabled
        && settings.collectOrbs
        && settings.showOrbToasts
        && settings.orbToastRarities.includes(orb.rarity);
}

function scanChat({ notify = false, rebuild = false } = {}) {
    const settings = getSettings();
    const context = getContext();
    const store = ensureStore();
    if (!context || !store) return { addedOrbs: [], removedOrbs: [], addedAchievements: [], removedAchievements: [] };

    if (rebuild) {
        store.orbs = [];
        // Achievement markers are stripped from saved messages after collection.
        // Keep stored achievements and prune only entries with live source links below.
    }

    const chat = Array.isArray(context.chat) ? context.chat : [];
    const parsedOrbsByMessage = new Map();
    const parsedAchievementsByMessage = new Map();
    const currentOrbKeys = new Set();
    const visibleMessageKeys = new Set();
    const existingMessageKeys = new Set();
    for (let i = 0; i < chat.length; i += 1) {
        const message = chat[i];
        if (!message || message.is_user) continue;
        visibleMessageKeys.add(getMessageStableKey(message, i));
        addExistingMessageKeys(existingMessageKeys, message, i);

        if (settings.collectOrbs) {
            const parsedOrbs = parseOrbsFromMessage(message, i);
            parsedOrbsByMessage.set(i, parsedOrbs);
            for (const orb of parsedOrbs) addOrbKeys(currentOrbKeys, orb);
        }

        if (settings.achievementsEnabled) {
            parsedAchievementsByMessage.set(i, parseAchievementsFromMessage(message, i));
        }
    }

    const removedOrbs = settings.collectOrbs ? pruneMissingOrbs(store, currentOrbKeys) : [];
    const migratedAchievementSources = settings.achievementsEnabled
        ? migrateAchievementSourcesFromAchievements(store)
        : 0;
    const removedAchievementSources = settings.achievementsEnabled
        ? pruneMissingAchievementSources(store, existingMessageKeys)
        : [];
    const ignoredOrbHashes = new Set(store.ignoredOrbHashes || []);
    const ignoredAchievementHashes = new Set(store.ignoredAchievementHashes || []);
    const knownOrbHashes = new Set();
    for (const orb of store.orbs) {
        normalizeStoredOrbIdentity(orb);
        addOrbKeys(knownOrbHashes, orb);
    }

    const achievementCandidates = new Map();
    if (settings.achievementsEnabled) {
        for (const source of getCurrentAchievementSources(store, existingMessageKeys)) {
            achievementCandidates.set(getAchievementSourceHash(source), source);
        }
        for (const parsedAchievements of parsedAchievementsByMessage.values()) {
            for (const achievement of parsedAchievements) {
                achievementCandidates.set(getAchievementSourceHash(achievement), achievement);
            }
        }
    }
    const currentAchievementSourceHashes = new Set(achievementCandidates.keys());
    const removedAchievements = settings.achievementsEnabled
        ? pruneMissingAchievements(store, currentAchievementSourceHashes)
        : [];
    const knownAchievementHashes = new Set(store.achievements.map((achievement) => achievement.hash));
    const knownAchievementContent = new Set(store.achievements.map(achievementContentKey));
    const knownAchievementTitles = new Set(store.achievements.map(achievementTitleKey).filter(Boolean));
    const addedOrbs = [];
    const addedAchievements = [];
    let addedAchievementSources = 0;
    let restoredAchievements = 0;
    let strippedAchievementMarkers = 0;
    let lastAcceptedAchievementMessageIndex = getLastAcceptedChatAchievementIndex(store);

    for (let i = 0; i < chat.length; i += 1) {
        const message = chat[i];
        if (!message || message.is_user) continue;

        if (settings.collectOrbs) {
            for (const orb of parsedOrbsByMessage.get(i) || []) {
                if (hasKnownOrbKey(ignoredOrbHashes, orb)) continue;
                if (hasKnownOrbKey(knownOrbHashes, orb)) continue;
                addOrbKeys(knownOrbHashes, orb);
                store.orbs.push(orb);
                addedOrbs.push(orb);
            }
        }

        if (settings.achievementsEnabled) {
            if (stripAchievementMarkersFromMessage(message)) {
                strippedAchievementMarkers += 1;
            }
        }
    }

    if (settings.achievementsEnabled) {
        const sortedCandidates = [...achievementCandidates.values()]
            .map(achievementFromSource)
            .sort((a, b) => Number(a.messageIndex ?? 0) - Number(b.messageIndex ?? 0)
                || Number(a.createdAt || 0) - Number(b.createdAt || 0));
        for (const achievement of sortedCandidates) {
            if (ignoredAchievementHashes.has(achievement.hash)) continue;
            if (knownAchievementHashes.has(achievement.hash)) {
                if (upsertAchievementSource(store, achievement)) addedAchievementSources += 1;
                continue;
            }
            if (achievement.restoredFromSource) {
                knownAchievementHashes.add(achievement.hash);
                knownAchievementContent.add(achievementContentKey(achievement));
                const titleKey = achievementTitleKey(achievement);
                if (titleKey) knownAchievementTitles.add(titleKey);
                store.achievements.push(achievement);
                restoredAchievements += 1;
                continue;
            }
            const contentKey = achievementContentKey(achievement);
            const titleKey = achievementTitleKey(achievement);
            if (settings.dedupeAchievements && (knownAchievementContent.has(contentKey) || (titleKey && knownAchievementTitles.has(titleKey)))) continue;
            if (isAchievementBlockedByCooldown(achievement.messageIndex, lastAcceptedAchievementMessageIndex, settings)) {
                if (settings.debugVerbose) {
                    console.info(`[${MODULE_NAME}] achievement skipped by local cooldown`, {
                        title: achievement.title,
                        messageIndex: achievement.messageIndex,
                        lastAcceptedAchievementMessageIndex,
                        cooldown: settings.achievementCooldown,
                    });
                }
                continue;
            }
            knownAchievementHashes.add(achievement.hash);
            knownAchievementContent.add(contentKey);
            if (titleKey) knownAchievementTitles.add(titleKey);
            if (upsertAchievementSource(store, achievement)) addedAchievementSources += 1;
            store.achievements.push(achievement);
            addedAchievements.push(achievement);
            lastAcceptedAchievementMessageIndex = Number(achievement.messageIndex);
        }
    }

    if (addedOrbs.length || addedAchievements.length || addedAchievementSources || restoredAchievements || migratedAchievementSources || removedOrbs.length || removedAchievements.length || removedAchievementSources.length || strippedAchievementMarkers || rebuild) {
        store.orbs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
        store.achievements.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
        persistChat();
    }

    if (addedOrbs.length) {
        checkMilestones(notify);
    }

    if (notify) {
        for (const achievement of addedAchievements) {
            if (settings.showAchievementToasts) showAchievementToast(achievement);
        }
        for (const orb of addedOrbs) {
            if (shouldNotifyOrb(orb)) showOrbToast(orb);
        }
    }

    if (settings.debugVerbose && (addedOrbs.length || addedAchievements.length || addedAchievementSources || restoredAchievements || migratedAchievementSources || removedOrbs.length || removedAchievements.length || removedAchievementSources.length || strippedAchievementMarkers || rebuild)) {
        console.info(`[${MODULE_NAME}] scan`, { rebuild, addedOrbs, removedOrbs, addedAchievements, restoredAchievements, migratedAchievementSources, removedAchievements, removedAchievementSources, strippedAchievementMarkers, stats: getStats(store) });
    }

    renderFloatingButton();
    renderPanel();
    syncSettingsControls();
    return { addedOrbs, removedOrbs, addedAchievements, removedAchievements };
}

function scheduleScan(notify = false, { resetNotify = false } = {}) {
    if (resetNotify) {
        scanShouldNotify = false;
        scanNotifyUntil = 0;
    }
    if (notify) {
        scanShouldNotify = true;
        scanNotifyUntil = Date.now() + 3000;
    }
    const shouldNotify = scanShouldNotify || Date.now() <= scanNotifyUntil;
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
        scanTimer = null;
        const notifyNow = scanShouldNotify || Date.now() <= scanNotifyUntil;
        scanShouldNotify = false;
        const result = scanChat({ notify: notifyNow });
        const changed = result.addedOrbs.length > 0
            || result.addedAchievements.length > 0
            || result.removedOrbs.length > 0
            || result.removedAchievements.length > 0;
        if (notifyNow && changed) {
            scanNotifyUntil = 0;
        } else if (notifyNow && Date.now() <= scanNotifyUntil) {
            scheduleScan(false);
        }
    }, shouldNotify ? 650 : 320);
}

function getAchievementCooldownInfo() {
    const settings = getSettings();
    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const lastIndex = getLastAcceptedChatAchievementIndex();

    if (lastIndex < 0) {
        return { remaining: 0, sinceLast: null, cooldown: settings.achievementCooldown };
    }
    const sinceLast = Math.max(0, chat.length - 1 - lastIndex);
    return {
        remaining: Math.max(0, settings.achievementCooldown - sinceLast),
        sinceLast,
        cooldown: settings.achievementCooldown,
    };
}

function applyTemplateVars(template, vars) {
    let output = String(template || '');
    for (const [key, value] of Object.entries(vars)) {
        output = output.replaceAll(`{{${key}}}`, String(value));
    }
    return output;
}

function getAchievementPromptState() {
    const settings = getSettings();
    const cooldown = getAchievementCooldownInfo();
    const vars = {
        cooldown: cooldown.cooldown,
        remaining: cooldown.remaining,
        since_last: cooldown.sinceLast ?? 0,
    };
    const enabled = !!(settings.enabled && settings.achievementsEnabled && settings.injectAchievementPrompt);
    return {
        enabled,
        mode: enabled && cooldown.remaining > 0 ? 'cooldown' : 'award',
        cooldown,
        prompt: enabled
            ? applyTemplateVars(cooldown.remaining > 0 ? settings.negativeAchievementPrompt : settings.achievementPrompt, vars)
            : '',
    };
}

function applyPromptInjection() {
    const settings = getSettings();
    if (!settings.enabled || !settings.achievementsEnabled || !settings.injectAchievementPrompt) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.NONE, 0, false, settings.injectRole);
        return;
    }

    const promptState = getAchievementPromptState();
    const position = Number(settings.injectPosition ?? extension_prompt_types.IN_CHAT);
    const depth = position === extension_prompt_types.IN_CHAT ? settings.injectDepth : 0;
    setExtensionPrompt(PROMPT_KEY, promptState.prompt, position, depth, false, settings.injectRole);
}

function scheduleHideAchievementMarkers() {
    window.clearTimeout(hideTimer);
    hideAchievementMarkersInDOM();
    hideTimer = window.setTimeout(() => {
        hideTimer = null;
        hideAchievementMarkersInDOM();
    }, 120);
}

function hideAchievementMarkersInDOM() {
    const containers = document.querySelectorAll('.mes_text, .message_text');
    for (const container of containers) {
        stripAchievementMarkersFromElement(container);
    }
}

function ensureHideObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
        if (!hideObserverPaused) scheduleHideAchievementMarkers();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function getTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
}

function getTextRangePosition(nodes, targetOffset) {
    let offset = 0;
    for (const node of nodes) {
        const length = node.nodeValue?.length || 0;
        if (targetOffset <= offset + length) {
            return { node, offset: Math.max(0, targetOffset - offset) };
        }
        offset += length;
    }
    const fallback = nodes[nodes.length - 1];
    return fallback ? { node: fallback, offset: fallback.nodeValue?.length || 0 } : null;
}

function stripAchievementMarkersFromElement(root) {
    let changed = false;
    for (let guard = 0; guard < 20; guard += 1) {
        const text = root.textContent || '';
        if (!text.includes('[ACHIEVEMENT:')) break;
        ACHIEVEMENT_HIDE_REGEX.lastIndex = 0;
        const match = ACHIEVEMENT_HIDE_REGEX.exec(text);
        if (!match) break;

        const nodes = getTextNodes(root);
        const start = getTextRangePosition(nodes, match.index);
        const end = getTextRangePosition(nodes, match.index + match[0].length);
        if (!start || !end) break;

        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        hideObserverPaused = true;
        try {
            range.deleteContents();
            root.normalize();
        } finally {
            range.detach();
            hideObserverPaused = false;
        }
        changed = true;
    }
    if (hideObserverPaused) hideObserverPaused = false;
    return changed;
}

function ensureToastContainer() {
    let container = document.getElementById('bbcv-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'bbcv-toast-container';
        document.body.appendChild(container);
    }
    const settings = getSettings();
    container.style.top = '';
    container.style.right = '';
    container.style.bottom = '';
    container.style.left = '';
    container.style.alignItems = '';
    container.style.flexDirection = 'column';
    switch (settings.toastCorner) {
        case 'top_left':
            container.style.top = '14px';
            container.style.left = '12px';
            container.style.alignItems = 'flex-start';
            break;
        case 'bottom_right':
            container.style.bottom = '14px';
            container.style.right = '12px';
            container.style.alignItems = 'flex-end';
            container.style.flexDirection = 'column-reverse';
            break;
        case 'bottom_left':
            container.style.bottom = '14px';
            container.style.left = '12px';
            container.style.alignItems = 'flex-start';
            container.style.flexDirection = 'column-reverse';
            break;
        default:
            container.style.top = '14px';
            container.style.right = '12px';
            container.style.alignItems = 'flex-end';
            break;
    }
    applyAppearance();
    return container;
}

function showToast(html, className = '') {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `bbcv-toast ${className}`;
    toast.innerHTML = html;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('bbcv-toast-show'));
    window.setTimeout(() => {
        toast.classList.remove('bbcv-toast-show');
        window.setTimeout(() => toast.remove(), 260);
    }, 5200);
}

function playNotificationSound(kind = 'achievement') {
    const settings = getSettings();
    if (!settings.soundEnabled || settings.soundVolume <= 0) return;
    if (kind === 'achievement' && !settings.soundOnAchievements) return;
    if (kind === 'orb' && !settings.soundOnOrbs) return;

    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!audioContext) audioContext = new AudioContextClass();
        if (audioContext.state === 'suspended') audioContext.resume?.();

        const now = audioContext.currentTime;
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.soundVolume / 260), now + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'orb' ? 0.42 : 0.34));
        gain.connect(audioContext.destination);

        const makeTone = (frequency, start, duration, type = 'sine') => {
            const oscillator = audioContext.createOscillator();
            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, now + start);
            oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.012, now + start + duration);
            oscillator.connect(gain);
            oscillator.start(now + start);
            oscillator.stop(now + start + duration);
        };

        if (kind === 'orb') {
            makeTone(660, 0, 0.32, 'sine');
            makeTone(990, 0.06, 0.26, 'triangle');
        } else {
            makeTone(523.25, 0, 0.15, 'triangle');
            makeTone(783.99, 0.12, 0.18, 'triangle');
        }
    } catch (error) {
        if (settings.debugVerbose) console.warn(`[${MODULE_NAME}] notification sound failed`, error);
    }
}

function showOrbToast(orb) {
    playNotificationSound('orb');
    showToast(`
        <div class="bbcv-toast-orb-icon" style="--a:${escapeHtml(orb.paletteA)};--b:${escapeHtml(orb.paletteB)};--g:${escapeHtml(orb.paletteGlow)}"></div>
        <div class="bbcv-toast-copy">
            <div class="bbcv-toast-kicker">Орб добавлен в коллекцию</div>
            <div class="bbcv-toast-title">${escapeHtml(orb.title)}</div>
            <div class="bbcv-toast-desc">${escapeHtml(orb.source)} · ${escapeHtml(orb.fragmentType)}</div>
        </div>
    `, `bbcv-toast-rarity-${orb.rarity.toLowerCase()}`);
}

function showAchievementToast(achievement) {
    playNotificationSound('achievement');
    showToast(`
        <div class="bbcv-toast-achievement-icon">${escapeHtml(achievement.emoji || '🏆')}</div>
        <div class="bbcv-toast-copy">
            <div class="bbcv-toast-kicker">ДОСТИЖЕНИЕ ПОЛУЧЕНО</div>
            <div class="bbcv-toast-title">${escapeHtml(achievement.title)}</div>
            <div class="bbcv-toast-desc">${escapeHtml(achievement.description)}</div>
        </div>
    `, `bbcv-toast-achievement bbcv-achievement-${achievement.rarity}`);
}

function renderSettings() {
    if (document.getElementById('bbcv-settings')) return;
    const target = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!target) return;

    target.insertAdjacentHTML('beforeend', `
        <div id="bbcv-settings" class="inline-drawer bbcv-settings">
            <div class="inline-drawer-toggle inline-drawer-header bbcv-settings-head">
                <div class="bbcv-settings-title-wrap">
                    <div class="bbcv-settings-title">
                        <i class="fa-solid fa-box-archive"></i>
                        <span>BB Collection Vault</span>
                    </div>
                    <div id="bbcv-settings-counts" class="bbcv-settings-subtitle"></div>
                </div>
                <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
            </div>

            <div class="inline-drawer-content bbcv-settings-content">
                <div class="bbcv-settings-quickbar">
                    <button id="bbcv-open-settings-vault" class="menu_button bbcv-icon-text" type="button">
                        <i class="fa-solid fa-box-open"></i><span>Открыть коллекцию</span>
                    </button>
                    <button id="bbcv-rescan" class="menu_button bbcv-icon-text" type="button">
                        <i class="fa-solid fa-rotate"></i><span>Обновить коллекцию</span>
                    </button>
                    <button id="bbcv-test-orb-toast" class="menu_button bbcv-icon-text" type="button">
                        <i class="fa-solid fa-wand-magic-sparkles"></i><span>Тест уведомления орба</span>
                    </button>
                </div>

                <div class="bbcv-settings-tabs">
                    <button class="bbcv-settings-tab" type="button" data-settings-tab="collection"><i class="fa-solid fa-layer-group"></i><span>Коллекция</span></button>
                    <button class="bbcv-settings-tab" type="button" data-settings-tab="notifications"><i class="fa-solid fa-bell"></i><span>Уведомления</span></button>
                    <button class="bbcv-settings-tab" type="button" data-settings-tab="appearance"><i class="fa-solid fa-palette"></i><span>Оформление</span></button>
                    <button class="bbcv-settings-tab" type="button" data-settings-tab="prompt"><i class="fa-solid fa-scroll"></i><span>Промпты</span></button>
                    <button class="bbcv-settings-tab" type="button" data-settings-tab="debug"><i class="fa-solid fa-screwdriver-wrench"></i><span>Отладка</span></button>
                </div>

                <section class="bbcv-settings-panel" data-settings-panel="collection">
                    <div class="bbcv-settings-card">
                        <div class="bbcv-card-title">Что собирать</div>
                        <div class="bbcv-card-help">Орбы сохраняются из текущего чата. Ачивки появляются реже: модель предлагает маркер, а коллекция дополнительно фильтрует повторы и кулдаун.</div>
                        <div class="bbcv-settings-grid">
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-enabled" type="checkbox"><span><strong>Включить коллекцию</strong><small>Главный переключатель расширения для текущего интерфейса.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-collect-orbs" type="checkbox"><span><strong>Сохранять орбы из чата</strong><small>В коллекцию попадают все найденные орбы, независимо от редкости.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-achievements-enabled" type="checkbox"><span><strong>Собирать ачивки</strong><small>Сохраняет достижения из ответов и локальные достижения за коллекцию.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-inject-achievements" type="checkbox"><span><strong>Просить модель выдавать ачивки</strong><small>Добавляет в промпт правило для редких достижений за важные моменты.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-show-fab" type="checkbox"><span><strong>Показывать кнопку коллекции поверх чата</strong><small>Это маленькая перетаскиваемая кнопка с количеством орбов.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-dedupe-achievements" type="checkbox"><span><strong>Не сохранять одинаковые ачивки</strong><small>Помогает не плодить повторные достижения с тем же смыслом.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-enforce-achievement-cooldown" type="checkbox"><span><strong>Применять кулдаун в расширении</strong><small>Если модель выдаст ачивку слишком рано, коллекция ее проигнорирует.</small></span></label>
                            <label class="bbcv-field">Минимум сообщений между ачивками
                                <input id="bbcv-achievement-cooldown" class="text_pole" type="number" min="1" max="99" step="1">
                                <small class="bbcv-field-note">Считаются сообщения после последней сохраненной чат-ачивки.</small>
                            </label>
                        </div>
                    </div>
                </section>

                <section class="bbcv-settings-panel" data-settings-panel="notifications">
                    <div class="bbcv-settings-card">
                        <div class="bbcv-card-title">Когда уведомлять</div>
                        <div class="bbcv-card-help">Все орбы все равно сохраняются. Здесь настраиваются только всплывающие уведомления и звук.</div>
                        <div class="bbcv-settings-grid">
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-orb-toasts" type="checkbox"><span><strong>Показывать уведомления об орбах</strong><small>Редкости выбираются ниже. Сохранение орбов от этого не зависит.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-achievement-toasts" type="checkbox"><span><strong>Показывать уведомления об ачивках</strong><small>Срабатывает для чат-ачивок и достижений самой коллекции.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-sound-enabled" type="checkbox"><span><strong>Звук уведомлений</strong><small>Общий переключатель короткого звука для всплывающих уведомлений.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-sound-achievements" type="checkbox"><span><strong>Звук для ачивок</strong><small>Можно оставить визуальные уведомления, но выключить звук отдельно.</small></span></label>
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-sound-orbs" type="checkbox"><span><strong>Звук для уведомлений орбов</strong><small>Играет только для тех редкостей, которые выбраны ниже.</small></span></label>
                            <label class="bbcv-field">Где показывать уведомления
                                <select id="bbcv-toast-corner" class="text_pole">
                                    <option value="top_right">Верхний правый</option>
                                    <option value="top_left">Верхний левый</option>
                                    <option value="bottom_right">Нижний правый</option>
                                    <option value="bottom_left">Нижний левый</option>
                                </select>
                            </label>
                            <label class="bbcv-field">Размер уведомлений
                                <input id="bbcv-toast-scale" class="text_pole" type="range" min="80" max="130" step="5">
                            </label>
                            <label class="bbcv-field">Громкость
                                <input id="bbcv-sound-volume" class="text_pole" type="range" min="0" max="100" step="5">
                            </label>
                        </div>
                        <div class="bbcv-settings-row">
                            <span class="bbcv-settings-label">Показывать уведомления для орбов редкости:</span>
                            ${ORB_RARITIES.map((rarity) => `
                                <label class="checkbox_label bbcv-rarity-toggle">
                                    <input class="bbcv-orb-rarity" type="checkbox" value="${rarity}">
                                    <span>${rarity}</span>
                                </label>
                            `).join('')}
                        </div>
                        <div class="bbcv-toast-color-box">
                            <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-toast-custom-colors" type="checkbox"><span><strong>Настроить цвета уведомлений отдельно</strong><small>Если выключено, уведомления берут тему и акцент из внешнего вида коллекции.</small></span></label>
                            <div class="bbcv-toast-color-grid">
                                <label class="bbcv-field">Фон уведомления
                                    <input id="bbcv-toast-bg-color" class="text_pole" type="color">
                                </label>
                                <label class="bbcv-field">Текст уведомления
                                    <input id="bbcv-toast-text-color" class="text_pole" type="color">
                                </label>
                                <label class="bbcv-field">Акцент уведомления
                                    <input id="bbcv-toast-accent-color" class="text_pole" type="color">
                                </label>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="bbcv-settings-panel" data-settings-panel="appearance">
                    <div class="bbcv-settings-card">
                        <div class="bbcv-card-title">Внешний вид коллекции</div>
                        <div class="bbcv-card-help">Эти настройки меняют окно коллекции и кнопку поверх чата. Цвета уведомлений можно настроить отдельно во вкладке "Уведомления".</div>
                        <div class="bbcv-settings-grid">
                            <label class="bbcv-field">Тема
                                <select id="bbcv-appearance-theme" class="text_pole">
                                    <option value="midnight">Midnight archive</option>
                                    <option value="glass">Soft glass</option>
                                    <option value="ember">Ember relic</option>
                                    <option value="mono">Monochrome</option>
                                </select>
                            </label>
                            <label class="bbcv-field">Плотность панели
                                <select id="bbcv-panel-density" class="text_pole">
                                    <option value="compact">Компактно</option>
                                    <option value="cozy">Уютно</option>
                                    <option value="wide">Просторно</option>
                                </select>
                            </label>
                            <label class="bbcv-field">Акцентный цвет коллекции
                                <input id="bbcv-accent-color" class="text_pole" type="color">
                            </label>
                        </div>
                    </div>
                </section>

                <section class="bbcv-settings-panel" data-settings-panel="prompt">
                    <div class="bbcv-settings-card">
                        <div class="bbcv-card-title">Промпты ачивок</div>
                        <div class="bbcv-card-help">Основной промпт просит модель выдавать достижения за важные моменты. Промпт кулдауна временно запрещает маркер, пока пауза не прошла.</div>
                        <label class="bbcv-field">Промпт выдачи ачивок
                            <textarea id="bbcv-achievement-prompt" class="text_pole bbcv-prompt-box"></textarea>
                        </label>
                        <label class="bbcv-field">Промпт запрета во время кулдауна
                            <textarea id="bbcv-negative-achievement-prompt" class="text_pole bbcv-prompt-box bbcv-prompt-box-small"></textarea>
                        </label>
                    </div>
                </section>

                <section class="bbcv-settings-panel" data-settings-panel="debug">
                    <div class="bbcv-settings-card">
                        <div class="bbcv-card-title">Отладка и обслуживание</div>
                        <div class="bbcv-card-help">Для проверки уведомлений, пересбора коллекции и просмотра состояния в консоли браузера.</div>
                        <label class="checkbox_label bbcv-checkbox-field"><input id="bbcv-debug-verbose" type="checkbox"><span><strong>Подробные логи в консоль</strong><small>Полезно, если нужно понять, почему орб или ачивка не сохранились.</small></span></label>
                        <div class="bbcv-debug-grid">
                            <button id="bbcv-rebuild" class="menu_button bbcv-icon-text" type="button"><i class="fa-solid fa-arrows-rotate"></i><span>Пересобрать коллекцию из чата</span></button>
                            <button id="bbcv-test-achievement-toast" class="menu_button bbcv-icon-text" type="button"><i class="fa-solid fa-trophy"></i><span>Тест ачивки</span></button>
                            <button id="bbcv-grant-debug-achievement" class="menu_button bbcv-icon-text" type="button"><i class="fa-solid fa-plus"></i><span>Сохранить тестовую ачивку</span></button>
                            <button id="bbcv-dump-state" class="menu_button bbcv-icon-text" type="button"><i class="fa-solid fa-terminal"></i><span>Показать состояние в консоли</span></button>
                            <button id="bbcv-clear" class="menu_button danger bbcv-icon-text" type="button"><i class="fa-solid fa-trash"></i><span>Очистить коллекцию чата</span></button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    `);

    activateSettingsTab(settingsUiState.activeTab);
    syncSettingsControls();
    bindSettingsControls();
}

function activateSettingsTab(tab) {
    settingsUiState.activeTab = tab || 'collection';
    document.querySelectorAll('#bbcv-settings .bbcv-settings-tab').forEach((button) => {
        const active = button.getAttribute('data-settings-tab') === settingsUiState.activeTab;
        button.classList.toggle('bbcv-settings-tab-active', active);
    });
    document.querySelectorAll('#bbcv-settings .bbcv-settings-panel').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-settings-panel') !== settingsUiState.activeTab;
    });
}

function syncSettingsControls() {
    const settings = getSettings();
    const stats = getStats();
    jQuery('#bbcv-settings-counts').text(`${stats.orbs} орбов · ${stats.achievements} ачивок · ${stats.rare} rare · ${stats.anomaly} anomaly`);
    jQuery('#bbcv-enabled').prop('checked', !!settings.enabled);
    jQuery('#bbcv-collect-orbs').prop('checked', !!settings.collectOrbs);
    jQuery('#bbcv-achievements-enabled').prop('checked', !!settings.achievementsEnabled);
    jQuery('#bbcv-inject-achievements').prop('checked', !!settings.injectAchievementPrompt);
    jQuery('#bbcv-show-fab').prop('checked', !!settings.showFloatingButton);
    jQuery('#bbcv-orb-toasts').prop('checked', !!settings.showOrbToasts);
    jQuery('#bbcv-achievement-toasts').prop('checked', !!settings.showAchievementToasts);
    jQuery('#bbcv-dedupe-achievements').prop('checked', !!settings.dedupeAchievements);
    jQuery('#bbcv-enforce-achievement-cooldown').prop('checked', !!settings.enforceAchievementCooldown);
    jQuery('#bbcv-debug-verbose').prop('checked', !!settings.debugVerbose);
    jQuery('#bbcv-sound-enabled').prop('checked', !!settings.soundEnabled);
    jQuery('#bbcv-sound-achievements').prop('checked', !!settings.soundOnAchievements);
    jQuery('#bbcv-sound-orbs').prop('checked', !!settings.soundOnOrbs);
    jQuery('#bbcv-sound-volume').val(settings.soundVolume);
    jQuery('#bbcv-achievement-cooldown').val(settings.achievementCooldown);
    jQuery('#bbcv-achievement-prompt').val(settings.achievementPrompt);
    jQuery('#bbcv-negative-achievement-prompt').val(settings.negativeAchievementPrompt);
    jQuery('#bbcv-appearance-theme').val(settings.appearanceTheme);
    jQuery('#bbcv-accent-color').val(settings.accentColor);
    jQuery('#bbcv-panel-density').val(settings.panelDensity);
    jQuery('#bbcv-toast-corner').val(settings.toastCorner);
    jQuery('#bbcv-toast-scale').val(settings.toastScale);
    jQuery('#bbcv-toast-custom-colors').prop('checked', !!settings.toastUseCustomColors);
    jQuery('#bbcv-toast-bg-color').val(settings.toastBgColor);
    jQuery('#bbcv-toast-text-color').val(settings.toastTextColor);
    jQuery('#bbcv-toast-accent-color').val(settings.toastAccentColor);
    jQuery('.bbcv-toast-color-grid input').prop('disabled', !settings.toastUseCustomColors);
    jQuery('.bbcv-orb-rarity').each(function syncRarity() {
        jQuery(this).prop('checked', settings.orbToastRarities.includes(String(this.value)));
    });
    applyAppearance();
}

function bindSettingsControls() {
    const settings = getSettings();
    const saveAndRefresh = () => {
        saveSettings();
        applyPromptInjection();
        renderFloatingButton();
        renderPanel();
        syncSettingsControls();
    };

    jQuery('#bbcv-settings .bbcv-settings-tab').on('click', function onTabClick() {
        activateSettingsTab(String(this.getAttribute('data-settings-tab') || 'collection'));
    });
    jQuery('#bbcv-enabled').on('change', function onChange() { settings.enabled = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-collect-orbs').on('change', function onChange() { settings.collectOrbs = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-achievements-enabled').on('change', function onChange() { settings.achievementsEnabled = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-inject-achievements').on('change', function onChange() { settings.injectAchievementPrompt = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-show-fab').on('change', function onChange() { settings.showFloatingButton = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-orb-toasts').on('change', function onChange() { settings.showOrbToasts = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-achievement-toasts').on('change', function onChange() { settings.showAchievementToasts = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-dedupe-achievements').on('change', function onChange() { settings.dedupeAchievements = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-enforce-achievement-cooldown').on('change', function onChange() { settings.enforceAchievementCooldown = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-debug-verbose').on('change', function onChange() { settings.debugVerbose = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-sound-enabled').on('change', function onChange() { settings.soundEnabled = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-sound-achievements').on('change', function onChange() { settings.soundOnAchievements = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-sound-orbs').on('change', function onChange() { settings.soundOnOrbs = this.checked; saveAndRefresh(); });
    jQuery('#bbcv-sound-volume').on('input change', function onChange() {
        settings.soundVolume = Math.min(100, Math.max(0, Number(this.value) || 0));
        saveAndRefresh();
    });
    jQuery('#bbcv-achievement-cooldown').on('input change', function onChange() {
        settings.achievementCooldown = Math.max(1, Number(this.value) || DEFAULT_SETTINGS.achievementCooldown);
        saveAndRefresh();
    });
    jQuery('#bbcv-achievement-prompt').on('input change', function onChange() {
        settings.achievementPrompt = String(this.value || DEFAULT_ACHIEVEMENT_PROMPT);
        saveAndRefresh();
    });
    jQuery('#bbcv-negative-achievement-prompt').on('input change', function onChange() {
        settings.negativeAchievementPrompt = String(this.value || DEFAULT_NEGATIVE_PROMPT);
        saveAndRefresh();
    });
    jQuery('#bbcv-appearance-theme').on('change', function onChange() {
        settings.appearanceTheme = String(this.value || DEFAULT_SETTINGS.appearanceTheme);
        saveAndRefresh();
    });
    jQuery('#bbcv-accent-color').on('input change', function onChange() {
        settings.accentColor = normalizeHex(this.value, DEFAULT_SETTINGS.accentColor);
        saveAndRefresh();
    });
    jQuery('#bbcv-panel-density').on('change', function onChange() {
        settings.panelDensity = String(this.value || DEFAULT_SETTINGS.panelDensity);
        saveAndRefresh();
    });
    jQuery('#bbcv-toast-corner').on('change', function onChange() {
        settings.toastCorner = String(this.value || DEFAULT_SETTINGS.toastCorner);
        saveAndRefresh();
    });
    jQuery('#bbcv-toast-scale').on('input change', function onChange() {
        settings.toastScale = Math.min(130, Math.max(80, Number(this.value) || DEFAULT_SETTINGS.toastScale));
        saveAndRefresh();
    });
    jQuery('#bbcv-toast-custom-colors').on('change', function onChange() {
        settings.toastUseCustomColors = this.checked;
        saveAndRefresh();
    });
    jQuery('#bbcv-toast-bg-color').on('input change', function onChange() {
        settings.toastBgColor = normalizeHex(this.value, DEFAULT_SETTINGS.toastBgColor);
        saveAndRefresh();
    });
    jQuery('#bbcv-toast-text-color').on('input change', function onChange() {
        settings.toastTextColor = normalizeHex(this.value, DEFAULT_SETTINGS.toastTextColor);
        saveAndRefresh();
    });
    jQuery('#bbcv-toast-accent-color').on('input change', function onChange() {
        settings.toastAccentColor = normalizeHex(this.value, DEFAULT_SETTINGS.toastAccentColor);
        saveAndRefresh();
    });
    jQuery('.bbcv-orb-rarity').on('change', function onChange() {
        const selected = [];
        jQuery('.bbcv-orb-rarity:checked').each(function eachRarity() {
            selected.push(String(this.value));
        });
        settings.orbToastRarities = selected;
        saveAndRefresh();
    });

    jQuery('#bbcv-open-settings-vault').on('click', () => openPanel('orbs'));
    jQuery('#bbcv-rescan').on('click', () => {
        const result = scanChat({ rebuild: false });
        toastr?.success?.(`BB Collection Vault: +${result.addedOrbs.length} орбов, -${result.removedOrbs.length} орбов, +${result.addedAchievements.length} ачивок, -${result.removedAchievements.length} ачивок.`);
        syncSettingsControls();
    });
    jQuery('#bbcv-rebuild').on('click', () => {
        scanChat({ rebuild: true });
        toastr?.success?.('BB Collection Vault: коллекция пересобрана из чата.');
        syncSettingsControls();
    });
    jQuery('#bbcv-test-orb-toast').on('click', () => {
        showOrbToast({
            title: 'Пробный отголосок',
            source: 'Проверка коллекции',
            rarity: 'Rare',
            fragmentType: 'Тест',
            paletteA: settings.accentColor,
            paletteB: '#283246',
            paletteGlow: '#ffffff',
        });
    });
    jQuery('#bbcv-test-achievement-toast').on('click', () => {
        showAchievementToast({
            emoji: '🏆',
            title: 'Проверка витрины',
            description: 'Тестовое уведомление без сохранения в коллекцию.',
            rarity: 'rare',
        });
    });
    jQuery('#bbcv-grant-debug-achievement').on('click', () => {
        const added = grantVaultAchievement({
            id: `debug_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            emoji: '🧪',
            title: 'Ручная проба',
            description: 'Тестовая ачивка из панели отладки коллекции.',
            rarity: 'common',
        }, true);
        if (added) {
            syncSettingsControls();
            renderPanel();
        }
    });
    jQuery('#bbcv-dump-state').on('click', () => {
        const dump = {
            settings: structuredClone(getSettings()),
            stats: getStats(),
            store: structuredClone(ensureStore() || {}),
        };
        console.info(`[${MODULE_NAME}] debug dump`, dump);
        toastr?.info?.('BB Collection Vault: состояние отправлено в консоль.');
    });
    jQuery('#bbcv-clear').on('click', () => {
        if (!window.confirm('Очистить все орбы и ачивки коллекции для текущего чата?')) return;
        const store = ensureStore();
        if (!store) return;
        store.orbs = [];
        store.achievements = [];
        store.achievementSources = [];
        persistChat();
        renderFloatingButton();
        renderPanel();
        syncSettingsControls();
    });
}

function ensureFloatingButton() {
    if (document.getElementById('bbcv-fab')) {
        renderFloatingButton();
        return;
    }
    const button = document.createElement('button');
    button.id = 'bbcv-fab';
    button.type = 'button';
    button.title = 'Открыть BB Коллекцию';
    button.innerHTML = `
        <span class="bbcv-fab-icon"><i class="fa-solid fa-box-archive"></i></span>
        <span class="bbcv-fab-count">0</span>
    `;
    document.body.appendChild(button);
    button.addEventListener('click', (event) => {
        if (fabDrag?.moved) {
            event.preventDefault();
            return;
        }
        openPanel('orbs');
    });
    button.addEventListener('pointerdown', startFabDrag);
    renderFloatingButton();
}

function clampNumber(value, min, max) {
    const safeMax = Math.max(min, max);
    return Math.min(safeMax, Math.max(min, value));
}

function getViewportSize() {
    const root = document.documentElement;
    return {
        width: Math.max(1, window.innerWidth || root?.clientWidth || 1),
        height: Math.max(1, window.innerHeight || root?.clientHeight || 1),
    };
}

function getClampedFabPosition(x, y, width, height) {
    const viewport = getViewportSize();
    const safeWidth = Math.max(1, Number(width) || 58);
    const safeHeight = Math.max(1, Number(height) || 42);
    return {
        x: clampNumber(Number(x) || FAB_VIEWPORT_MARGIN, FAB_VIEWPORT_MARGIN, viewport.width - safeWidth - FAB_VIEWPORT_MARGIN),
        y: clampNumber(Number(y) || 180, FAB_VIEWPORT_MARGIN, viewport.height - safeHeight - FAB_VIEWPORT_MARGIN),
    };
}

function getDefaultFabPosition(button) {
    const viewport = getViewportSize();
    const width = button.offsetWidth || button.getBoundingClientRect().width || 58;
    const height = button.offsetHeight || button.getBoundingClientRect().height || 42;
    const right = viewport.width <= 760 ? 10 : 18;
    const bottom = viewport.width <= 760 ? 74 : 88;
    return getClampedFabPosition(viewport.width - width - right, viewport.height - height - bottom, width, height);
}

function placeFloatingButton(button, x, y, persist = false) {
    const settings = getSettings();
    const width = button.offsetWidth || button.getBoundingClientRect().width || 58;
    const height = button.offsetHeight || button.getBoundingClientRect().height || 42;
    const position = getClampedFabPosition(x, y, width, height);
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';

    const changed = settings.fabX !== position.x || settings.fabY !== position.y;
    if (persist) {
        settings.fabX = position.x;
        settings.fabY = position.y;
        if (changed) saveSettings();
    }
}

function startFabDrag(event) {
    const settings = getSettings();
    const button = document.getElementById('bbcv-fab');
    if (!button || event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    fabDrag = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false,
    };
    button.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
        if (!fabDrag) return;
        if (Math.abs(moveEvent.clientX - fabDrag.startX) > 4 || Math.abs(moveEvent.clientY - fabDrag.startY) > 4) {
            fabDrag.moved = true;
        }
        const nextX = moveEvent.clientX - fabDrag.offsetX;
        const nextY = moveEvent.clientY - fabDrag.offsetY;
        const position = getClampedFabPosition(nextX, nextY, rect.width || button.offsetWidth, rect.height || button.offsetHeight);
        button.style.left = `${position.x}px`;
        button.style.top = `${position.y}px`;
        button.style.right = 'auto';
        button.style.bottom = 'auto';
        settings.fabX = position.x;
        settings.fabY = position.y;
    };
    const end = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        saveSettings();
        window.setTimeout(() => { fabDrag = null; }, 0);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
}

function renderFloatingButton() {
    const settings = getSettings();
    const button = document.getElementById('bbcv-fab');
    if (!button) return;
    const store = ensureStore();
    const stats = getStats(store);
    button.hidden = !settings.enabled || !settings.showFloatingButton;
    button.querySelector('.bbcv-fab-count').textContent = String(stats.orbs);
    if (button.hidden) {
        applyAppearance();
        return;
    }
    const hasSavedPosition = settings.fabX !== null
        && settings.fabY !== null
        && Number.isFinite(Number(settings.fabX))
        && Number.isFinite(Number(settings.fabY));
    if (hasSavedPosition) {
        placeFloatingButton(button, settings.fabX, settings.fabY, true);
    } else {
        const position = getDefaultFabPosition(button);
        placeFloatingButton(button, position.x, position.y);
    }
    applyAppearance();
}

function ensurePanel() {
    if (document.getElementById('bbcv-panel')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="bbcv-panel" class="bbcv-panel" hidden>
            <div class="bbcv-panel-backdrop" data-bbcv-close></div>
            <section class="bbcv-panel-shell" role="dialog" aria-modal="true" aria-label="BB Collection Vault">
                <header class="bbcv-panel-head">
                    <div>
                        <div class="bbcv-panel-title">BB Collection Vault</div>
                        <div id="bbcv-panel-stats" class="bbcv-panel-stats"></div>
                    </div>
                    <button class="bbcv-icon-button" type="button" title="Закрыть" data-bbcv-close>
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </header>
                <nav class="bbcv-tabs">
                    <button class="bbcv-tab" type="button" data-tab="orbs"><i class="fa-solid fa-circle-nodes"></i><span>Орбы</span></button>
                    <button class="bbcv-tab" type="button" data-tab="achievements"><i class="fa-solid fa-trophy"></i><span>Ачивки</span></button>
                </nav>
                <div class="bbcv-panel-body">
                    <section id="bbcv-orbs-view" class="bbcv-view"></section>
                    <section id="bbcv-achievements-view" class="bbcv-view"></section>
                </div>
            </section>
        </div>
    `);

    document.querySelectorAll('[data-bbcv-close]').forEach((node) => {
        node.addEventListener('click', closePanel);
    });
    document.querySelectorAll('.bbcv-tab').forEach((node) => {
        node.addEventListener('click', () => {
            uiState.activeTab = node.getAttribute('data-tab') || 'orbs';
            renderPanel();
        });
    });
    applyAppearance();
}

function openPanel(tab = 'orbs') {
    ensurePanel();
    uiState.activeTab = tab;
    const panel = document.getElementById('bbcv-panel');
    if (panel) panel.hidden = false;
    scanChat({ notify: false });
    renderPanel();
}

function closePanel() {
    const panel = document.getElementById('bbcv-panel');
    if (panel) panel.hidden = true;
}

function getFilteredOrbs(orbs) {
    const query = uiState.search.toLowerCase();
    return orbs
        .filter((orb) => uiState.rarityFilter === 'all' || orb.rarity === uiState.rarityFilter)
        .filter((orb) => {
            if (!query) return true;
            return [orb.title, orb.source, orb.fragmentType, orb.text, orb.rarity]
                .some((value) => String(value || '').toLowerCase().includes(query));
        })
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function renderPanel() {
    const panel = document.getElementById('bbcv-panel');
    if (!panel || panel.hidden) return;
    applyAppearance();
    const store = ensureStore();
    const stats = getStats(store);
    const orbs = Array.isArray(store?.orbs) ? store.orbs : [];
    const achievements = Array.isArray(store?.achievements) ? store.achievements : [];

    document.getElementById('bbcv-panel-stats').textContent =
        `${stats.orbs} орбов · ${stats.achievements} ачивок · Rare ${stats.rare} · Anomaly ${stats.anomaly}`;

    document.querySelectorAll('.bbcv-tab').forEach((tab) => {
        tab.classList.toggle('bbcv-tab-active', tab.getAttribute('data-tab') === uiState.activeTab);
    });
    document.getElementById('bbcv-orbs-view').hidden = uiState.activeTab !== 'orbs';
    document.getElementById('bbcv-achievements-view').hidden = uiState.activeTab !== 'achievements';

    renderOrbsView(orbs);
    renderAchievementsView(achievements);
}

function renderOrbsView(orbs) {
    const root = document.getElementById('bbcv-orbs-view');
    if (!root) return;
    const filtered = getFilteredOrbs(orbs);
    const selected = filtered.find((orb) => orb.hash === uiState.selectedOrbHash) || filtered[0] || null;
    uiState.selectedOrbHash = selected?.hash || '';

    root.innerHTML = `
        <div class="bbcv-toolbar">
            <label class="bbcv-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input id="bbcv-orb-search" type="search" placeholder="Поиск по источнику, типу, тексту..." value="${escapeHtml(uiState.search)}">
            </label>
            <select id="bbcv-orb-rarity-filter" class="text_pole">
                <option value="all">Все редкости</option>
                ${ORB_RARITIES.map((rarity) => `<option value="${rarity}" ${uiState.rarityFilter === rarity ? 'selected' : ''}>${rarity}</option>`).join('')}
            </select>
            <button id="bbcv-panel-rescan" class="menu_button bbcv-icon-text" type="button"><i class="fa-solid fa-rotate"></i><span>Обновить</span></button>
        </div>
        <div class="bbcv-orb-layout">
            <div class="bbcv-orb-grid">
                ${filtered.length ? filtered.map(renderOrbCard).join('') : '<div class="bbcv-empty">Пока пусто. Орбы появятся здесь после сообщений с LORE_ORB-блоками.</div>'}
            </div>
            <aside class="bbcv-orb-detail">
                ${selected ? renderOrbDetail(selected) : '<div class="bbcv-empty">Выбери орб, чтобы открыть фрагмент.</div>'}
            </aside>
        </div>
    `;

    root.querySelector('#bbcv-orb-search')?.addEventListener('input', (event) => {
        uiState.search = String(event.target.value || '');
        renderPanel();
    });
    root.querySelector('#bbcv-orb-rarity-filter')?.addEventListener('change', (event) => {
        uiState.rarityFilter = String(event.target.value || 'all');
        renderPanel();
    });
    root.querySelector('#bbcv-panel-rescan')?.addEventListener('click', () => scanChat({ rebuild: false }));
    root.querySelectorAll('.bbcv-orb-card').forEach((card) => {
        card.addEventListener('click', () => {
            uiState.selectedOrbHash = card.getAttribute('data-hash') || '';
            renderPanel();
        });
    });
    root.querySelector('#bbcv-delete-selected-orb')?.addEventListener('click', () => {
        deleteOrb(uiState.selectedOrbHash);
    });
}

function renderOrbCard(orb) {
    return `
        <button class="bbcv-orb-card ${orb.hash === uiState.selectedOrbHash ? 'bbcv-orb-card-active' : ''}"
            type="button"
            data-hash="${escapeHtml(orb.hash)}"
            style="--a:${escapeHtml(orb.paletteA)};--b:${escapeHtml(orb.paletteB)};--g:${escapeHtml(orb.paletteGlow)}">
            <span class="bbcv-mini-orb"></span>
            <span class="bbcv-orb-card-copy">
                <span class="bbcv-orb-card-title">${escapeHtml(orb.title)}</span>
                <span class="bbcv-orb-card-meta">${escapeHtml(orb.rarity)} · ${escapeHtml(orb.fragmentType)}</span>
            </span>
        </button>
    `;
}

function renderOrbDetail(orb) {
    return `
        <div class="bbcv-orb-detail-head" style="--a:${escapeHtml(orb.paletteA)};--b:${escapeHtml(orb.paletteB)};--g:${escapeHtml(orb.paletteGlow)}">
            <div class="bbcv-large-orb"></div>
            <div>
                <div class="bbcv-detail-kicker">${escapeHtml(orb.rarity)} · ${escapeHtml(orb.fragmentType)}</div>
                <h3>${escapeHtml(orb.title)}</h3>
                <div class="bbcv-detail-source">${escapeHtml(orb.source)}</div>
            </div>
        </div>
        <div class="bbcv-detail-text">${escapeHtml(orb.text || 'Текст фрагмента пуст.').replace(/\n/g, '<br>')}</div>
        <div class="bbcv-detail-foot">
            <span>${escapeHtml(formatDate(orb.createdAt))}</span>
            <button id="bbcv-delete-selected-orb" class="menu_button danger bbcv-icon-text" type="button"><i class="fa-solid fa-trash"></i><span>Удалить</span></button>
        </div>
    `;
}

function renderAchievementsView(achievements) {
    const root = document.getElementById('bbcv-achievements-view');
    if (!root) return;
    const list = [...achievements].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    root.innerHTML = `
        <div class="bbcv-achievements-list">
            ${list.length ? list.map(renderAchievementItem).join('') : '<div class="bbcv-empty">Ачивок пока нет. Коллекция поймает маркеры ACHIEVEMENT или выдаст достижения за собранные орбы.</div>'}
        </div>
    `;
    root.querySelectorAll('.bbcv-achievement-delete').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteAchievement(button.getAttribute('data-achievement-id') || '');
        });
    });
}

function renderAchievementItem(item) {
    return `
        <article class="bbcv-achievement-item bbcv-achievement-${escapeHtml(item.rarity)}">
            <div class="bbcv-achievement-emoji">${escapeHtml(item.emoji || '🏆')}</div>
            <div class="bbcv-achievement-copy">
                <div class="bbcv-achievement-title">${escapeHtml(item.title)}</div>
                <div class="bbcv-achievement-desc">${escapeHtml(item.description)}</div>
                <div class="bbcv-achievement-meta">${escapeHtml(item.rarity)} · ${escapeHtml(item.source === 'vault' ? 'Коллекция' : 'Чат')} · ${escapeHtml(formatDate(item.createdAt))}</div>
            </div>
            <button class="bbcv-icon-button bbcv-achievement-delete" type="button" title="Удалить ачивку" data-achievement-id="${escapeHtml(item.id)}">
                <i class="fa-solid fa-trash"></i>
            </button>
        </article>
    `;
}

function deleteOrb(hash) {
    const store = ensureStore();
    if (!store || !hash) return;
    const target = store.orbs.find((orb) => orb.hash === hash);
    if (target) {
        const ignored = new Set(store.ignoredOrbHashes || []);
        for (const key of getOrbIdentityKeys(target)) ignored.add(key);
        store.ignoredOrbHashes = [...ignored];
    }
    store.orbs = store.orbs.filter((orb) => orb.hash !== hash);
    uiState.selectedOrbHash = '';
    persistChat();
    renderFloatingButton();
    renderPanel();
    syncSettingsControls();
}

function deleteAchievement(id) {
    const store = ensureStore();
    if (!store || !id) return;
    const target = store.achievements.find((achievement) => achievement.id === id || achievement.hash === id);
    if (target) {
        const ignored = new Set(store.ignoredAchievementHashes || []);
        if (target.id) ignored.add(target.id);
        if (target.hash) ignored.add(target.hash);
        if (target.sourceHash) ignored.add(target.sourceHash);
        ignored.add(getAchievementSourceHash(target));
        store.ignoredAchievementHashes = [...ignored];
    }
    store.achievements = store.achievements.filter((achievement) => achievement.id !== id && achievement.hash !== id);
    persistChat();
    renderFloatingButton();
    renderPanel();
    syncSettingsControls();
}

function onChatChanged() {
    applyPromptInjection();
    scheduleScan(false, { resetNotify: true });
    scheduleHideAchievementMarkers();
}

function onMessageEvent(notify = false) {
    applyPromptInjection();
    scheduleScan(notify);
    scheduleHideAchievementMarkers();
}

function init() {
    getSettings();
    renderSettings();
    ensureFloatingButton();
    ensurePanel();
    ensureHideObserver();
    applyPromptInjection();
    scheduleScan(false);
    scheduleHideAchievementMarkers();

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GENERATION_STARTED, applyPromptInjection);
    eventSource.on(event_types.MESSAGE_RECEIVED, () => onMessageEvent(true));
    eventSource.on(event_types.MESSAGE_SWIPED, () => onMessageEvent(false));
    eventSource.on(event_types.MESSAGE_EDITED, () => onMessageEvent(false));
    eventSource.on(event_types.MESSAGE_UPDATED, () => onMessageEvent(false));
    eventSource.on(event_types.MESSAGE_DELETED, () => onMessageEvent(false));
    eventSource.on(event_types.MESSAGE_SWIPE_DELETED, () => onMessageEvent(false));
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => onMessageEvent(false));
    window.addEventListener('resize', renderFloatingButton);
    window.addEventListener('orientationchange', () => window.setTimeout(renderFloatingButton, 120));

    window.BBCollectionVault = {
        scan: () => scanChat({ rebuild: false }),
        rebuild: () => scanChat({ rebuild: true }),
        open: () => openPanel('orbs'),
        store: () => ensureStore(),
        cooldown: () => getAchievementCooldownInfo(),
        promptState: () => getAchievementPromptState(),
    };

    console.log(`[${MODULE_NAME}] loaded`);
}

jQuery(() => {
    init();
});
