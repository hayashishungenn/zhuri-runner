/**
 * 障碍/道具目录 schema 与校验（纯 TS，零 cc 依赖）。
 * 数据文件：assets/resources/obstacle-catalog.json（Phase 3 数据驱动挑战机制）。
 */

export type PassKind = 'jump' | 'slide' | 'lane' | 'timing';
export type DamageKind = 'stumble' | 'death';
export type VisKind = 'rock' | 'log' | 'beam' | 'wall' | 'arch' | 'gap' | 'water' | 'fire' | 'fence' | 'vine' | 'bridge' | 'roller';

export interface ObstacleDef {
    id: string;
    label: string;
    /** 通行条件：跳跃 / 滑铲 / 切道 / 时机（摆动/滚石） */
    pass: PassKind;
    /** 失败受击等级：踉跄（可承受）/ 即死 */
    damage: DamageKind;
    /** 占道数 1-3（锚点向右扩展，clamp 到 ±1） */
    lanes: number;
    vis: VisKind;
    tint: [number, number, number];
    scale?: number;
    /** 时机障碍：占道在 lanes 间以 period 周期切换 */
    osc?: { period: number; lanes: [number, number] };
    /** 滚石：连续横移速度（车道/秒） */
    rollSpeed?: number;
    /** 难度解锁阈值 D ∈ [0,1] */
    unlockD?: number;
    tier?: number;
}

export interface PatternStep { def: string; lane: number; dz: number; }
export interface PatternDef {
    id: string;
    weight: number;
    tier: number;
    steps: PatternStep[];
}
export interface ItemDef {
    id: string;
    label: string;
    weight: number;
    /** 持续秒；0 = 即时效果 */
    duration: number;
}
export interface CatalogSpawnCfg {
    itemChance: number;
    patternChance: number;
    randomPoolTier0: string[];
    randomPoolTier1: string[];
    randomPoolTier2: string[];
}

export interface ObstacleCatalog {
    obstacles: ObstacleDef[];
    patterns: PatternDef[];
    items: ItemDef[];
    spawn: CatalogSpawnCfg;
}

const PASSES: PassKind[] = ['jump', 'slide', 'lane', 'timing'];
const DAMAGES: DamageKind[] = ['stumble', 'death'];
const VIS: VisKind[] = ['rock', 'log', 'beam', 'wall', 'arch', 'gap', 'water', 'fire', 'fence', 'vine', 'bridge', 'roller'];
const ITEM_IDS = ['magnet', 'shield', 'dash', 'double', 'water', 'staff', 'leap'];

export function validateCatalog(raw: unknown): string[] {
    const errs: string[] = [];
    if (typeof raw !== 'object' || raw === null) return ['目录根节点必须是对象'];
    const obj = raw as Record<string, unknown>;
    const ids = new Set<string>();

    const obs = obj.obstacles;
    if (!Array.isArray(obs) || obs.length < 20) {
        errs.push(`obstacles 必须为 ≥20 项的数组（任务书要求 ≥20 种），实际 ${Array.isArray(obs) ? obs.length : '非数组'}`);
    } else {
        for (const o of obs as unknown[]) {
            const d = o as Record<string, unknown>;
            if (typeof d.id !== 'string' || !d.id) { errs.push('obstacle.id 缺失'); continue; }
            if (ids.has(d.id)) errs.push(`obstacle.id 重复: ${d.id}`);
            ids.add(d.id);
            if (!PASSES.includes(d.pass as PassKind)) errs.push(`${d.id}.pass 非法: ${d.pass}`);
            if (!DAMAGES.includes(d.damage as DamageKind)) errs.push(`${d.id}.damage 非法: ${d.damage}`);
            if (!VIS.includes(d.vis as VisKind)) errs.push(`${d.id}.vis 非法: ${d.vis}`);
            if (typeof d.lanes !== 'number' || d.lanes < 1 || d.lanes > 3 || !Number.isInteger(d.lanes)) errs.push(`${d.id}.lanes 必须为 1-3 整数`);
            if (!Array.isArray(d.tint) || d.tint.length !== 3) errs.push(`${d.id}.tint 必须为 [r,g,b]`);
            if (d.pass === 'timing' && !d.osc && !d.rollSpeed) errs.push(`${d.id}: timing 障碍需 osc 或 rollSpeed`);
            if (typeof d.unlockD === 'number' && (d.unlockD < 0 || d.unlockD > 1)) errs.push(`${d.id}.unlockD 必须在 [0,1]`);
        }
    }

    const patterns = obj.patterns;
    if (!Array.isArray(patterns) || !patterns.length) errs.push('patterns 必须为非空数组');
    else {
        const pids = new Set<string>();
        for (const p of patterns as unknown[]) {
            const d = p as Record<string, unknown>;
            if (typeof d.id !== 'string' || !d.id) { errs.push('pattern.id 缺失'); continue; }
            if (pids.has(d.id)) errs.push(`pattern.id 重复: ${d.id}`);
            pids.add(d.id);
            if (typeof d.weight !== 'number' || d.weight <= 0) errs.push(`${d.id}.weight 必须 >0`);
            if (typeof d.tier !== 'number' || d.tier < 0 || d.tier > 2) errs.push(`${d.id}.tier 必须为 0-2`);
            if (!Array.isArray(d.steps) || !d.steps.length) { errs.push(`${d.id}.steps 必须为非空数组`); continue; }
            for (const st of d.steps as unknown[]) {
                const t = st as Record<string, unknown>;
                if (t.def !== 'random' && !ids.has(t.def as string)) errs.push(`${d.id} 引用未定义障碍: ${t.def}`);
                if (typeof t.lane !== 'number' || t.lane < -1 || t.lane > 1) errs.push(`${d.id}.lane 必须在 [-1,1]`);
                if (typeof t.dz !== 'number' || t.dz < 0) errs.push(`${d.id}.dz 不能为负`);
            }
        }
    }

    const items = obj.items;
    if (!Array.isArray(items) || items.length !== ITEM_IDS.length) errs.push(`items 必须为 ${ITEM_IDS.length} 项`);
    else {
        const got = new Set<string>();
        for (const it of items as unknown[]) {
            const d = it as Record<string, unknown>;
            const id = String(d.id);
            if (!ITEM_IDS.includes(id)) errs.push(`item.id 非法: ${d.id}`);
            if (got.has(id)) errs.push(`item.id 重复: ${d.id}`);
            got.add(id);
            if (typeof d.weight !== 'number' || d.weight <= 0) errs.push(`${d.id}.weight 必须 >0`);
            if (typeof d.duration !== 'number' || d.duration < 0) errs.push(`${d.id}.duration 不能为负`);
        }
    }

    const sp = obj.spawn as Record<string, unknown> | undefined;
    if (typeof sp !== 'object' || sp === null) errs.push('spawn 缺失');
    else {
        if (typeof sp.itemChance !== 'number' || sp.itemChance < 0 || sp.itemChance > 1) errs.push('spawn.itemChance 必须在 [0,1]');
        if (typeof sp.patternChance !== 'number' || sp.patternChance < 0 || sp.patternChance > 1) errs.push('spawn.patternChance 必须在 [0,1]');
        for (const k of ['randomPoolTier0', 'randomPoolTier1', 'randomPoolTier2'] as const) {
            const pool = sp[k];
            if (!Array.isArray(pool) || !pool.length) { errs.push(`spawn.${k} 必须为非空数组`); continue; }
            for (const idRaw of pool as unknown[]) {
                const id = String(idRaw);
                if (!ids.has(id)) errs.push(`spawn.${k} 引用未定义障碍: ${id}`);
            }
        }
    }
    return errs;
}

export function parseCatalog(raw: unknown): ObstacleCatalog {
    const errs = validateCatalog(raw);
    if (errs.length) throw new Error('obstacle-catalog 非法：\n  - ' + errs.join('\n  - '));
    return raw as ObstacleCatalog;
}

/** 内置默认目录（旧测试/无 JSON 环境兜底；与 obstacle-catalog.json 子集一致） */
export function defaultCatalog(): ObstacleCatalog {
    return {
        obstacles: [
            { id: 'rock', label: '岩石', pass: 'jump', damage: 'stumble', lanes: 1, vis: 'rock', tint: [96, 62, 38], tier: 0 },
            { id: 'log', label: '倒木横梁', pass: 'slide', damage: 'stumble', lanes: 1, vis: 'beam', tint: [64, 34, 15], tier: 0 },
            { id: 'wall', label: '岩墙', pass: 'lane', damage: 'death', lanes: 1, vis: 'wall', tint: [51, 29, 16], tier: 0 },
        ],
        patterns: [
            { id: 'single', weight: 30, tier: 0, steps: [{ def: 'random', lane: 0, dz: 0 }] },
            { id: 'double', weight: 26, tier: 0, steps: [{ def: 'random', lane: -1, dz: 0 }, { def: 'random', lane: 1, dz: 0 }] },
            { id: 'wallFrag', weight: 10, tier: 0, steps: [{ def: 'wall', lane: -1, dz: 0 }, { def: 'wall', lane: 0, dz: 0 }] },
        ],
        items: [
            { id: 'magnet', label: '磁吸', weight: 22, duration: 12 },
            { id: 'shield', label: '护盾', weight: 18, duration: 0 },
            { id: 'dash', label: '御风疾行', weight: 12, duration: 3 },
            { id: 'double', label: '阳炎倍率', weight: 18, duration: 10 },
            { id: 'water', label: '甘霖降临', weight: 16, duration: 0 },
            { id: 'staff', label: '桃木神杖', weight: 8, duration: 0 },
            { id: 'leap', label: '巨人之跃', weight: 12, duration: 10 },
        ],
        spawn: {
            itemChance: 0.22,
            patternChance: 0.45,
            randomPoolTier0: ['rock', 'log', 'wall'],
            randomPoolTier1: [],
            randomPoolTier2: [],
        },
    };
}
