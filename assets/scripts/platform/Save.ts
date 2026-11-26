/**
 * Save —— 版本化存档（Phase 6 v2）。
 * - 单一 JSON blob（zhuri.save）+ 校验和（djb2）+ 备份槽（zhuri.save.bak）
 * - 损坏处理：主档校验失败 → 读备份 → 均失败 → 默认值（永不抛错，游戏可玩）
 * - 迁移：v1 散键（zhuri.bestLi / zhuri.journeyDone）首次读入合并
 * - 不收集任何个人信息（仅游戏进度数值与设置）
 */
import { AdStatsData } from '../core/AdStats';

export interface Storage {
    get(key: string): string | null;
    set(key: string, value: string): void;
}

export const KEY_SAVE = 'zhuri.save';
export const KEY_SAVE_BAK = 'zhuri.save.bak';
export const KEY_V1_BEST = 'zhuri.bestLi';
export const KEY_V1_JOURNEY = 'zhuri.journeyDone';

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
    themeVisited: number[];      // 已到达的主题索引（去重）
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

function defaultAdStats(): AdStatsData {
    return { events: [], totals: { runs: 0, ends: 0, revives: 0, requests: 0, shows: 0, completes: 0, rewards: 0, fails: 0 } };
}

export function defaultSaveData(): SaveDataV2 {
    return {
        v: 2,
        bestLi: 0,
        journeyDone: false,
        gold: 0,
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
        settings: { muted: false },
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

export function serializeSave(data: SaveDataV2): string {
    const { checksum: _checksum, ...rest } = data;
    const body = JSON.stringify(rest);
    return JSON.stringify({ ...rest, checksum: checksumOf(body) });
}

/** 解析并校验；失败返回 null（调用方走备份/默认） */
export function parseSave(raw: string | null): SaveDataV2 | null {
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw) as SaveDataV2;
        if (!obj || typeof obj !== 'object' || obj.v !== 2) return null;
        const { checksum, ...rest } = obj;
        if (!checksum || checksumOf(JSON.stringify(rest)) !== checksum) return null;
        // 字段完整性：与默认合并（防缺字段）
        const def = defaultSaveData();
        return {
            ...def, ...rest,
            upgrades: { ...def.upgrades, ...(rest.upgrades ?? {}) },
            quests: { ...def.quests, ...(rest.quests ?? {}) },
            stats: { ...def.stats, ...(rest.stats ?? {}) },
            settings: { ...def.settings, ...(rest.settings ?? {}) },
            tutorial: { ...def.tutorial, ...(rest.tutorial ?? {}) },
            ads: {
                ...def.ads, ...(rest.ads ?? {}),
                totals: { ...def.ads.totals, ...(rest.ads?.totals ?? {}) },
                events: Array.isArray(rest.ads?.events) ? rest.ads!.events : [],
            },
            skinsOwned: Array.isArray(rest.skinsOwned) ? rest.skinsOwned : def.skinsOwned,
            achClaimed: Array.isArray(rest.achClaimed) ? rest.achClaimed : [],
        };
    } catch {
        return null;
    }
}

export class Save {
    private storage: Storage;
    data: SaveDataV2;

    constructor(storage: Storage) {
        this.storage = storage;
        this.data = this.load();
    }

    private load(): SaveDataV2 {
        // 主档 → 备份 → v1 迁移 → 默认
        const main = parseSave(this.storage.get(KEY_SAVE));
        if (main) { this.data = main; return main; }
        const bak = parseSave(this.storage.get(KEY_SAVE_BAK));
        if (bak) { this.data = bak; this.flush(); return bak; }
        // v1 迁移
        const def = defaultSaveData();
        const v1Best = Number(this.storage.get(KEY_V1_BEST) ?? 0);
        if (Number.isFinite(v1Best) && v1Best > 0) def.bestLi = Math.floor(v1Best);
        if (this.storage.get(KEY_V1_JOURNEY) === '1') def.journeyDone = true;
        this.data = def;
        this.flush();
        return def;
    }

    /** 主档写入 + 旧主档转入备份槽 */
    flush(): void {
        const cur = this.storage.get(KEY_SAVE);
        if (cur !== null) this.storage.set(KEY_SAVE_BAK, cur);
        this.storage.set(KEY_SAVE, serializeSave(this.data));
    }

    /** 恢复备份（设置页手动触发；无备份返回 false） */
    restoreBackup(): boolean {
        const bak = parseSave(this.storage.get(KEY_SAVE_BAK));
        if (!bak) return false;
        this.data = bak;
        this.flush();
        return true;
    }
}
