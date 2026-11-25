/**
 * 游戏配置 schema 与校验 —— 纯 TypeScript，零 cc 依赖（可在 Node 中单测）。
 * 数据文件：assets/resources/game-config.json
 * 规范要求：非法配置必须显式报错，不允许静默回退魔法数字。
 */

export type RenderMode = '2d' | '3d';
export type AdMode = 'mock' | 'wx';

export interface WorldCfg {
    laneCount: number;
    laneWidth: number;
    runwayHalf: number;
    spawnZ: number;
    despawnZ: number;
}
export interface SpeedCfg { base: number; gain: number; gainCap: number; }
export interface PlayerCfg {
    jumpDuration: number;
    jumpSafeFrom: number;
    jumpSafeTo: number;
    slideDuration: number;
    diveJumpTo: number;
    laneLerp: number;
    reviveInvincible: number;
    reviveClearZ: number;
    reviveKeepZ: number;
}
export interface SpawnCfg {
    rowInterval: number;
    singleRowChance: number;
    propInterval: number;
    fragmentChance: number;
    fragmentCount: number;
    fragmentGap: number;
    fragmentLead: number;
    treeChance: number;
    propSideMin: number;
    propSideSpread: number;
    propScaleMin: number;
    propScaleSpread: number;
}
export interface ObstacleCfg { hitZ: number; pickupZFrom: number; pickupZTo: number; }
export interface DeathCfg { slowmo: number; dieDelay: number; dieRate: number; slowmoRecover: number; ambientRecover: number; }
export interface MilestoneCfg { step: number; liScale: number; skyRange: number; }
export interface AdCfg { mode: AdMode; countdownSteps: number; stepDuration: number; adUnitId: string; }
export interface UiCfg {
    title: string; subtitle: string; hintSwipe: string; startBtn: string;
    deadTitle: string; reviveBtn: string; restartBtn: string; reviveNote: string;
    adTitle: string; adNote: string;
    milestoneText: string; distLabel: string; fragLabel: string;
    deadDistLabel: string; deadFragLabel: string;
}
export interface GameConfig {
    renderMode: RenderMode;
    world: WorldCfg;
    speed: SpeedCfg;
    player: PlayerCfg;
    spawn: SpawnCfg;
    obstacle: ObstacleCfg;
    death: DeathCfg;
    milestone: MilestoneCfg;
    ad: AdCfg;
    ui: UiCfg;
}

/** P0 原型实测数值（唯一真源，JSON 与此一致；仅测试兜底使用） */
export const DEFAULT_CONFIG: GameConfig = {
    renderMode: '3d',
    world: { laneCount: 3, laneWidth: 110, runwayHalf: 190, spawnZ: 46, despawnZ: -2 },
    speed: { base: 13, gain: 0.045, gainCap: 16 },
    player: {
        jumpDuration: 0.62, jumpSafeFrom: 0.12, jumpSafeTo: 0.88, slideDuration: 0.55, diveJumpTo: 0.42,
        laneLerp: 11, reviveInvincible: 2.2, reviveClearZ: 14, reviveKeepZ: 14,
    },
    spawn: {
        rowInterval: 8, singleRowChance: 0.45, propInterval: 2.4,
        fragmentChance: 0.6, fragmentCount: 5, fragmentGap: 1.5, fragmentLead: 1.6,
        treeChance: 0.7, propSideMin: 1.55, propSideSpread: 0.9,
        propScaleMin: 0.8, propScaleSpread: 0.7,
    },
    obstacle: { hitZ: 0.55, pickupZFrom: -0.5, pickupZTo: 0.9 },
    death: { slowmo: 0.25, dieDelay: 0.95, dieRate: 2.8, slowmoRecover: 1.4, ambientRecover: 3 },
    milestone: { step: 1000, liScale: 3, skyRange: 30000 },
    ad: { mode: 'mock', countdownSteps: 3, stepDuration: 0.85, adUnitId: '' },
    ui: {
        title: '逐 日', subtitle: '夸父逐日 · 神话跑酷',
        hintSwipe: '左右滑动变道 · 上滑跳跃 · 下滑俯冲', startBtn: '【 起 跑 】',
        deadTitle: '力 竭', reviveBtn: '▶ 观看广告 · 原地复活', restartBtn: '重新起跑',
        reviveNote: '复活每轮一次 · 真机接入 wx.createRewardedVideoAd',
        adTitle: '广告演示', adNote: '真实场景为 15-30 秒激励视频 · 看完才发奖',
        milestoneText: '日影渐近 · {n} 里', distLabel: '已逐 {n} 里', fragLabel: '阳炎 × {n}',
        deadDistLabel: '已逐日 {n} 里', deadFragLabel: '拾得阳炎 × {n}',
    },
};

type NumRule = { min?: number; max?: number; integer?: boolean };
const NUM_SECTIONS: Record<string, Record<string, NumRule>> = {
    world: { laneCount: { min: 1, integer: true }, laneWidth: { min: 1 }, runwayHalf: { min: 1 }, spawnZ: { min: 1 }, despawnZ: { max: 0 } },
    speed: { base: { min: 0.1 }, gain: { min: 0 }, gainCap: { min: 0 } },
    player: {
        jumpDuration: { min: 0.05 }, jumpSafeFrom: { min: 0, max: 1 }, jumpSafeTo: { min: 0, max: 1 },
        slideDuration: { min: 0.05 }, diveJumpTo: { min: 0, max: 1 },
        laneLerp: { min: 0.1 }, reviveInvincible: { min: 0 },
        reviveClearZ: { min: 0 }, reviveKeepZ: { min: 0 },
    },
    spawn: {
        rowInterval: { min: 0.1 }, singleRowChance: { min: 0, max: 1 }, propInterval: { min: 0.1 },
        fragmentChance: { min: 0, max: 1 }, fragmentCount: { min: 1, integer: true },
        fragmentGap: { min: 0.1 }, fragmentLead: { min: 0 }, treeChance: { min: 0, max: 1 },
        propSideMin: { min: 0.1 }, propSideSpread: { min: 0 },
        propScaleMin: { min: 0.01 }, propScaleSpread: { min: 0 },
    },
    obstacle: { hitZ: { min: -5 }, pickupZFrom: { min: -10 }, pickupZTo: { min: -10 } },
    death: { slowmo: { min: 0.01, max: 1 }, dieDelay: { min: 0.05 }, dieRate: { min: 0.1 }, slowmoRecover: { min: 0.01 }, ambientRecover: { min: 0.01 } },
    milestone: { step: { min: 1, integer: true }, liScale: { min: 0.01 }, skyRange: { min: 1 } },
    ad: { countdownSteps: { min: 1, integer: true }, stepDuration: { min: 0.05 } },
};

/**
 * 校验并返回错误列表；空数组即合法。
 * 除逐字段类型/取值域检查外，还做跨字段逻辑一致性检查。
 */
export function validateConfig(raw: unknown): string[] {
    const errs: string[] = [];
    if (typeof raw !== 'object' || raw === null) return ['根节点必须是对象'];

    const obj = raw as Record<string, unknown>;
    const hasOwn = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

    // 顶层必填 section
    for (const sec of ['renderMode', 'world', 'speed', 'player', 'spawn', 'obstacle', 'death', 'milestone', 'ad', 'ui']) {
        if (!hasOwn(obj, sec)) errs.push(`缺少字段 ${sec}`);
    }
    if (errs.length) return errs;

    // renderMode / ad.mode 枚举
    if (obj.renderMode !== '2d' && obj.renderMode !== '3d') errs.push(`renderMode 必须为 '2d'|'3d'，实际：${JSON.stringify(obj.renderMode)}`);
    const ad = obj.ad as Record<string, unknown>;
    if (ad.mode !== 'mock' && ad.mode !== 'wx') errs.push(`ad.mode 必须为 'mock'|'wx'，实际：${JSON.stringify(ad.mode)}`);
    if (typeof ad.adUnitId !== 'string') errs.push('ad.adUnitId 必须为字符串');
    if (ad.mode === 'wx' && !(ad.adUnitId as string).length) errs.push('ad.mode=wx 时 adUnitId 不能为空');

    // 数值 section
    for (const [secName, rules] of Object.entries(NUM_SECTIONS)) {
        const sec = obj[secName] as Record<string, unknown>;
        if (typeof sec !== 'object' || sec === null) { errs.push(`${secName} 必须是对象`); continue; }
        for (const [key, rule] of Object.entries(rules)) {
            if (!hasOwn(sec, key)) { errs.push(`缺少字段 ${secName}.${key}`); continue; }
            const v = sec[key];
            if (typeof v !== 'number' || !Number.isFinite(v)) { errs.push(`${secName}.${key} 必须是有限数字，实际：${JSON.stringify(v)}`); continue; }
            if (rule.integer && !Number.isInteger(v)) errs.push(`${secName}.${key} 必须为整数`);
            if (rule.min !== undefined && v < rule.min) errs.push(`${secName}.${key}=${v} 超出下限 ${rule.min}`);
            if (rule.max !== undefined && v > rule.max) errs.push(`${secName}.${key}=${v} 超出上限 ${rule.max}`);
        }
    }

    // ui 文案
    const ui = obj.ui as Record<string, unknown>;
    if (typeof ui !== 'object' || ui === null) errs.push('ui 必须是对象');
    else {
        for (const [k, v] of Object.entries(DEFAULT_CONFIG.ui)) {
            if (!hasOwn(ui, k)) errs.push(`缺少字段 ui.${k}`);
            else if (typeof ui[k] !== 'string') errs.push(`ui.${k} 必须为字符串，实际：${JSON.stringify(ui[k])}`);
            else if (v.includes('{n}') && !(ui[k] as string).includes('{n}')) errs.push(`ui.${k} 必须包含 {n} 占位符`);
        }
    }

    // 跨字段一致性
    if (errs.length === 0) {
        const c = obj as unknown as GameConfig;
        if (c.world.spawnZ <= c.obstacle.hitZ) errs.push('world.spawnZ 必须大于 obstacle.hitZ');
        if (c.player.jumpSafeFrom >= c.player.jumpSafeTo) errs.push('player.jumpSafeFrom 必须小于 jumpSafeTo');
        if (c.obstacle.pickupZFrom >= c.obstacle.pickupZTo) errs.push('obstacle.pickupZFrom 必须小于 pickupZTo');
        if (c.world.despawnZ >= c.obstacle.hitZ) errs.push('world.despawnZ 必须小于 obstacle.hitZ');
        if (c.speed.base + c.speed.gainCap < c.speed.base) errs.push('speed 配置非法');
    }
    return errs;
}

/** 校验通过则返回强类型配置，否则抛出聚合错误（规范：禁止静默回退） */
export function parseConfig(raw: unknown): GameConfig {
    const errs = validateConfig(raw);
    if (errs.length) throw new Error('game-config 非法：\n  - ' + errs.join('\n  - '));
    return raw as GameConfig;
}

/** 文案占位符替换 */
export function formatUi(tpl: string, n: number): string {
    return tpl.replace('{n}', String(n));
}
