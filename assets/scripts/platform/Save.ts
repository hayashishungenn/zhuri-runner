/**
 * Save —— 版本化存档（Phase 6 v2 / Phase 8.1 加固）。
 * - 单一 JSON blob（zhuri.save）+ 校验和（djb2）+ 备份槽（zhuri.save.bak）
 * - 字段类型与合法范围清洗（防负值/NaN/越界等级/缺失默认皮肤）
 * - 不兼容高版本保护（v > 2 时拒绝静默覆盖，保留原始存档）
 * - 损坏隔离（双档损坏时尽力保留受损原串于 zhuri.save.corrupt，并暴露明确 loadStatus）
 * - 存储异常捕获（quota/隐私模式异常永不崩溃，flush 返回 boolean 并记录 lastError）
 */
import { AdStatsData, defaultAdStats, mergeAdStats } from '../core/AdStats';
import { UPGRADE_DEFS } from '../core/Upgrades';
import { normalizeDate } from '../core/Quests';

export interface Storage {
    get(key: string): string | null;
    set(key: string, value: string): void;
}

export const CURRENT_SAVE_VERSION = 2;
export const KEY_SAVE = 'zhuri.save';
export const KEY_SAVE_BAK = 'zhuri.save.bak';
export const KEY_SAVE_CORRUPT = 'zhuri.save.corrupt';
export const KEY_V1_BEST = 'zhuri.bestLi';
export const KEY_V1_JOURNEY = 'zhuri.journeyDone';

export type SaveLoadStatus =
    | 'ok'
    | 'recovered_backup'
    | 'migrated_v1'
    | 'fresh'
    | 'corrupted_fallback'
    | 'incompatible_version'
    | 'storage_error';

export interface QuestSaveState {
    date: string;
    picks: string[];
    progress: Record<string, number>;
    claimed: string[];
}
export interface UpgradeSaveState { [kind: string]: number; }
export interface StatsSaveState {
    totalLi: number;
    totalFrags: number;
    runs: number;
    turns: number;
    obstaclesPassed: number;
    obstaclesSmashed: number;
    bestRunLi: number;
    themeVisited: number[];      // 已到达的主题索引（去重，归一化 0..3）
    itemUses: Record<string, number>;
    waterDrunk: number;
    goldEarned: number;
    coolRuns: number;            // 全程热量 <80 的完成次数
}

export interface SaveDataV2 {
    v: number;
    bestLi: number;
    journeyDone: boolean;
    gold: number;
    /** 经济事务日志（跨会话防重复领取；上限 512） */
    txLog: string[];
    skinsOwned: string[];        // 已解锁皮肤 id（'kuafu' 默认拥有）
    skin: string;                // 当前皮肤 id
    upgrades: UpgradeSaveState;
    quests: QuestSaveState;
    achClaimed: string[];
    stats: StatsSaveState;
    settings: { muted: boolean };
    tutorial: { done: boolean; skipped: boolean };
    /** Phase 7 商业化统计（本地，不上传） */
    ads: AdStatsData;
    checksum?: string;
}

export function defaultSaveData(): SaveDataV2 {
    return {
        v: CURRENT_SAVE_VERSION,
        bestLi: 0,
        journeyDone: false,
        gold: 0,
        txLog: [],
        skinsOwned: ['kuafu'],
        skin: 'kuafu',
        upgrades: {},
        quests: { date: '', picks: [], progress: {}, claimed: [] },
        achClaimed: [],
        stats: {
            totalLi: 0, totalFrags: 0, runs: 0, turns: 0,
            obstaclesPassed: 0, obstaclesSmashed: 0, bestRunLi: 0,
            themeVisited: [0], itemUses: {}, waterDrunk: 0,
            goldEarned: 0, coolRuns: 0,
        },
        settings: { muted: true },
        tutorial: { done: false, skipped: false },
        ads: defaultAdStats(),
    };
}

/** djb2 校验和 */
export function checksumOf(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
}

function nonNegInt(v: unknown, fallback = 0): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return fallback;
    return Math.floor(v);
}

function uniqStrings(v: unknown, maxLen?: number): string[] {
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of v) {
        if (typeof item === 'string' && item.length > 0 && !seen.has(item)) {
            seen.add(item);
            out.push(item);
        }
    }
    return maxLen !== undefined ? out.slice(-maxLen) : out;
}

/** 严格类型与合法范围清洗（保障内存态与持久化数据始终合法） */
export function sanitizeSaveData(rest: Partial<SaveDataV2>): SaveDataV2 {
    const def = defaultSaveData();
    const skinsOwned = uniqStrings(rest.skinsOwned);
    if (!skinsOwned.includes('kuafu')) skinsOwned.unshift('kuafu');
    const skin = typeof rest.skin === 'string' && skinsOwned.includes(rest.skin) ? rest.skin : 'kuafu';

    // 强化等级：仅保留已知类型并钳制到 [0, maxLevel]
    const upgrades: UpgradeSaveState = {};
    const rawUpg = (rest.upgrades && typeof rest.upgrades === 'object') ? rest.upgrades : {};
    for (const udef of UPGRADE_DEFS) {
        const rawLv = (rawUpg as Record<string, unknown>)[udef.kind];
        if (rawLv !== undefined) {
            const clamped = Math.min(udef.maxLevel, nonNegInt(rawLv, 0));
            upgrades[udef.kind] = clamped;
        }
    }

    // 任务状态
    const rawQ = (rest.quests && typeof rest.quests === 'object') ? rest.quests : def.quests;
    const qProgress: Record<string, number> = {};
    if (rawQ.progress && typeof rawQ.progress === 'object') {
        for (const [k, val] of Object.entries(rawQ.progress)) {
            qProgress[k] = nonNegInt(val, 0);
        }
    }
    const quests: QuestSaveState = {
        date: typeof rawQ.date === 'string' && rawQ.date ? normalizeDate(rawQ.date) : '',
        picks: uniqStrings(rawQ.picks),
        progress: qProgress,
        claimed: uniqStrings(rawQ.claimed),
    };

    // 统计状态
    const rawSt = (rest.stats && typeof rest.stats === 'object') ? rest.stats : def.stats;
    const itemUses: Record<string, number> = {};
    if (rawSt.itemUses && typeof rawSt.itemUses === 'object') {
        for (const [k, val] of Object.entries(rawSt.itemUses)) {
            itemUses[k] = nonNegInt(val, 0);
        }
    }
    const themeSet = new Set<number>([0]);
    if (Array.isArray(rawSt.themeVisited)) {
        for (const t of rawSt.themeVisited) {
            if (typeof t === 'number' && Number.isFinite(t) && t >= 0) {
                themeSet.add(Math.floor(t) % 4);
            }
        }
    }
    const stats: StatsSaveState = {
        totalLi: nonNegInt(rawSt.totalLi, 0),
        totalFrags: nonNegInt(rawSt.totalFrags, 0),
        runs: nonNegInt(rawSt.runs, 0),
        turns: nonNegInt(rawSt.turns, 0),
        obstaclesPassed: nonNegInt(rawSt.obstaclesPassed, 0),
        obstaclesSmashed: nonNegInt(rawSt.obstaclesSmashed, 0),
        bestRunLi: nonNegInt(rawSt.bestRunLi, 0),
        themeVisited: Array.from(themeSet).sort((a, b) => a - b),
        itemUses,
        waterDrunk: nonNegInt(rawSt.waterDrunk, 0),
        goldEarned: nonNegInt(rawSt.goldEarned, 0),
        coolRuns: nonNegInt(rawSt.coolRuns, 0),
    };

    // 广告统计清洗
    const adsMerged = mergeAdStats(rest.ads);
    adsMerged.interstitial.shownToday = nonNegInt(adsMerged.interstitial.shownToday, 0);
    adsMerged.interstitial.lastAt = nonNegInt(adsMerged.interstitial.lastAt, 0);
    adsMerged.interstitial.completedRuns = nonNegInt(adsMerged.interstitial.completedRuns, 0);

    return {
        v: CURRENT_SAVE_VERSION,
        bestLi: nonNegInt(rest.bestLi, 0),
        journeyDone: typeof rest.journeyDone === 'boolean' ? rest.journeyDone : false,
        gold: nonNegInt(rest.gold, 0),
        txLog: uniqStrings(rest.txLog, 512),
        skinsOwned,
        skin,
        upgrades,
        quests,
        achClaimed: uniqStrings(rest.achClaimed),
        stats,
        settings: {
            muted: typeof rest.settings?.muted === 'boolean' ? rest.settings.muted : def.settings.muted,
        },
        tutorial: {
            done: typeof rest.tutorial?.done === 'boolean' ? rest.tutorial.done : false,
            skipped: typeof rest.tutorial?.skipped === 'boolean' ? rest.tutorial.skipped : false,
        },
        ads: adsMerged,
    };
}

export function serializeSave(data: SaveDataV2): string {
    const clean = sanitizeSaveData(data);
    const body = JSON.stringify(clean);
    return JSON.stringify({ ...clean, checksum: checksumOf(body) });
}

/** 探测原始存档字符串中的版本号（用于识别不兼容高版本） */
export function inspectSaveVersion(raw: string | null): number | null {
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw) as { v?: unknown };
        if (obj && typeof obj === 'object' && typeof obj.v === 'number' && Number.isFinite(obj.v)) {
            return obj.v;
        }
        return null;
    } catch {
        return null;
    }
}

/** 解析、校验并清洗；失败返回 null（调用方走备份/迁移/默认） */
export function parseSave(raw: string | null): SaveDataV2 | null {
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw) as SaveDataV2;
        if (!obj || typeof obj !== 'object' || obj.v !== CURRENT_SAVE_VERSION) return null;
        const { checksum, ...rest } = obj;
        if (typeof checksum !== 'string' || !checksum || checksumOf(JSON.stringify(rest)) !== checksum) return null;
        return sanitizeSaveData(rest);
    } catch {
        return null;
    }
}

export class Save {
    private storage: Storage;
    data: SaveDataV2;
    loadStatus: SaveLoadStatus = 'fresh';
    lastError: string | null = null;
    /** 高版本不兼容保护锁：true 时拒绝自动覆盖主档，避免静默丢弃玩家高版本进度 */
    writeLocked = false;

    constructor(storage: Storage) {
        this.storage = storage;
        this.data = this.load();
    }

    private safeGet(key: string): { ok: boolean; value: string | null } {
        try {
            return { ok: true, value: this.storage.get(key) };
        } catch (e) {
            this.lastError = String(e);
            return { ok: false, value: null };
        }
    }

    private safeSet(key: string, value: string): boolean {
        try {
            this.storage.set(key, value);
            return true;
        } catch (e) {
            this.lastError = String(e);
            return false;
        }
    }

    private load(): SaveDataV2 {
        const mainRead = this.safeGet(KEY_SAVE);
        if (!mainRead.ok) {
            this.loadStatus = 'storage_error';
            return defaultSaveData();
        }
        const mainRaw = mainRead.value;
        const main = parseSave(mainRaw);
        if (main) {
            this.loadStatus = 'ok';
            return main;
        }

        // 不兼容高版本保护：禁止静默覆盖玩家进度
        const detectedV = inspectSaveVersion(mainRaw);
        if (detectedV !== null && detectedV > CURRENT_SAVE_VERSION) {
            this.loadStatus = 'incompatible_version';
            this.writeLocked = true;
            return defaultSaveData();
        }

        // 尝试从备份槽恢复
        const bakRead = this.safeGet(KEY_SAVE_BAK);
        const bak = bakRead.ok ? parseSave(bakRead.value) : null;
        if (bak) {
            this.loadStatus = 'recovered_backup';
            this.data = bak;
            this.flush();
            return bak;
        }

        // 若主档存在但损坏且无可用备份：保留受损原串于隔离槽，记录明确状态
        if (mainRaw !== null) {
            this.safeSet(KEY_SAVE_CORRUPT, mainRaw);
            this.loadStatus = 'corrupted_fallback';
            const def = defaultSaveData();
            this.data = def;
            this.flush();
            return def;
        }

        // v1 散键迁移
        const def = defaultSaveData();
        const v1BestRaw = this.safeGet(KEY_V1_BEST).value;
        const v1JourneyRaw = this.safeGet(KEY_V1_JOURNEY).value;
        let migrated = false;
        if (v1BestRaw !== null) {
            const v1Best = Number(v1BestRaw);
            if (Number.isFinite(v1Best) && v1Best > 0) {
                def.bestLi = Math.floor(v1Best);
                migrated = true;
            }
        }
        if (v1JourneyRaw === '1') {
            def.journeyDone = true;
            migrated = true;
        }
        this.loadStatus = migrated ? 'migrated_v1' : 'fresh';
        this.data = def;
        this.flush();
        return def;
    }

    /** 主档写入 + 仅将「有效」旧主档转入备份槽；存储异常返回 false 而不抛错 */
    flush(): boolean {
        if (this.writeLocked) return false;
        const curRead = this.safeGet(KEY_SAVE);
        if (curRead.ok && curRead.value !== null && parseSave(curRead.value)) {
            this.safeSet(KEY_SAVE_BAK, curRead.value);
        }
        const ok = this.safeSet(KEY_SAVE, serializeSave(this.data));
        if (!ok) this.loadStatus = 'storage_error';
        return ok;
    }

    /** 恢复备份（设置页手动触发；无备份返回 false） */
    restoreBackup(): boolean {
        const bakRead = this.safeGet(KEY_SAVE_BAK);
        const bak = bakRead.ok ? parseSave(bakRead.value) : null;
        if (!bak) return false;
        this.writeLocked = false;
        this.data = bak;
        this.loadStatus = 'recovered_backup';
        this.flush();
        return true;
    }
}
