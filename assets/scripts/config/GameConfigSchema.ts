/**
 * 游戏配置 schema 与校验 —— 纯 TypeScript，零 cc 依赖（可在 Node 中单测）。
 * 数据文件：assets/resources/game-config.json
 * 规范要求：非法配置必须显式报错，不允许静默回退魔法数字。
 */

export type RenderMode = '2d' | '3d';
export type AdMode = 'mock' | 'wx';
export type QualityLevel = 'low' | 'mid' | 'high';

export interface QualityCfg {
    /** 画质档位：控制网格分段/星数/粒子/装饰密度；不影响玩法判定 */
    level: QualityLevel;
}

export interface WorldCfg {
    laneCount: number;
    laneWidth: number;
    runwayHalf: number;
    spawnZ: number;
    despawnZ: number;
}
export interface SpeedCfg { base: number; gain: number; gainCap: number; }
export interface StumbleCfg {
    enabled: boolean;
    /** 踉跄期间速度倍率（<1 即减速） */
    speedFactor: number;
    /** 踉跄持续时间（秒） */
    duration: number;
    /** 踉跄触发的豁免无敌（秒） */
    mercyInvincible: number;
}
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
    stumble: StumbleCfg;
}
export interface InputCfg {
    /** 滑动最小位移（逻辑像素） */
    swipeMin: number;
    /** 点按最大位移（逻辑像素） */
    tapMax: number;
}
export interface CameraCfg {
    fovBase: number;
    /** 随速度增加的 fov 增量（速度达到 base+gainCap 时取满） */
    fovGain: number;
    /** 相机水平跟随插值速率（1/s） */
    followLerp: number;
    /** 跳跃高度跟随系数（0 关闭） */
    heightFollow: number;
}
export interface DifficultyCfg {
    /** 难度满值里程（里）：D = min(li/rampLi, 1) */
    rampLi: number;
    /** 动态生成间隔绝对下限（逻辑单位） */
    minInterval: number;
    /** 反应时间守卫（秒）：生成间隔 ≥ 速度×此值 */
    reactionGuard: number;
    /** 可达性验证的最小反应时间（秒） */
    reactionTime: number;
}
export interface HeatCfg {
    /** 基础升温速率（每秒） */
    baseRate: number;
    /** 难度对升温的放大系数 */
    dScale: number;
    /** 预警阈值 */
    warnAt: number;
    /** 热满时的强制减速倍率 */
    maxSlow: number;
    /** 饮水降温量 */
    waterReduce: number;
    /** 安全越过溪流降温量 */
    streamReduce: number;
    /** 保底触发热量 */
    pityHeat: number;
    /** 保底触发距离（距上次饮水资源） */
    pityDist: number;
}
export interface JourneyStage { goalLi: number; label: string; }
export interface JourneyCfg { stages: JourneyStage[]; }
export interface ThemeCfg {
    label: string;
    heatMul: number;
    itemMul: number;
    trackTint: [number, number, number];
    curbTint: [number, number, number];
}
export interface MapCfg {
    /** 路径生成种子（同种子路径可复现） */
    seed: number;
    /** 预生成距离（玩家前方，逻辑单位） */
    horizon: number;
    /** 回收距离（玩家身后） */
    recycleBehind: number;
    straightMin: number;
    straightMax: number;
    turnRadius: number;
    /** 转弯操作窗口（路口前开启距离） */
    turnWindow: number;
    turnGapMin: number;
    turnGapMax: number;
    slopeChance: number;
    slopeMin: number;
    slopeMax: number;
    slopeGrade: number;
    bridgeChance: number;
    cliffChance: number;
    caveChance: number;
    specialGap: number;
    themeEvery: number;
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
export interface AdCfg {
    mode: AdMode;
    /** 广告展示超时（毫秒） */
    timeoutMs: number;
    /** 按场景的广告位 ID（空 = 明确未配置，禁止编造） */
    adUnitIds: Record<string, string>;
    interstitialUnitId: string;
    interstitial: {
        enabled: boolean;
        firstRunProtection: number;
        cooldownMs: number;
        maxPerDay: number;
    };
}
export interface UiCfg {
    title: string; subtitle: string; hintSwipe: string; startBtn: string;
    deadTitle: string; reviveBtn: string; restartBtn: string; reviveNote: string;
    adTitle: string; adNote: string;
    milestoneText: string; distLabel: string; fragLabel: string;
    deadDistLabel: string; deadFragLabel: string;
    speedLabel: string; stumbleText: string;
    pausedTitle: string; resumeBtn: string;
    modeEndless: string; modeJourney: string; bestLabel: string;
    heatLabel: string; endedTitle: string; endedSub: string;
    stageLabel: string;
}
export interface GameConfig {
    renderMode: RenderMode;
    quality: QualityCfg;
    world: WorldCfg;
    speed: SpeedCfg;
    player: PlayerCfg;
    input: InputCfg;
    camera: CameraCfg;
    map: MapCfg;
    difficulty: DifficultyCfg;
    heat: HeatCfg;
    journey: JourneyCfg;
    themes: ThemeCfg[];
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
    quality: { level: 'mid' },
    world: { laneCount: 3, laneWidth: 110, runwayHalf: 190, spawnZ: 46, despawnZ: -2 },
    speed: { base: 13, gain: 0.045, gainCap: 16 },
    player: {
        jumpDuration: 0.62, jumpSafeFrom: 0.12, jumpSafeTo: 0.88, slideDuration: 0.55, diveJumpTo: 0.42,
        laneLerp: 11, reviveInvincible: 2.2, reviveClearZ: 14, reviveKeepZ: 14,
        stumble: { enabled: true, speedFactor: 0.45, duration: 1.8, mercyInvincible: 1.5 },
    },
    input: { swipeMin: 18, tapMax: 8 },
    camera: { fovBase: 58, fovGain: 10, followLerp: 8, heightFollow: 0.18 },
    map: {
        seed: 12345, horizon: 300, recycleBehind: 30,
        straightMin: 18, straightMax: 40,
        turnRadius: 6, turnWindow: 8, turnGapMin: 70, turnGapMax: 180,
        slopeChance: 0.18, slopeMin: 16, slopeMax: 30, slopeGrade: 0.12,
        bridgeChance: 0.08, cliffChance: 0.06, caveChance: 0.06, specialGap: 120,
        themeEvery: 400,
    },
    difficulty: { rampLi: 6000, minInterval: 3, reactionGuard: 0.45, reactionTime: 0.3 },
    heat: {
        baseRate: 1.2, dScale: 0.5, warnAt: 80, maxSlow: 0.75,
        waterReduce: 40, streamReduce: 10, pityHeat: 70, pityDist: 300,
    },
    journey: {
        stages: [
            { goalLi: 2000, label: '跨过大荒山林' },
            { goalLi: 4000, label: '渡过黄河渭水' },
            { goalLi: 6000, label: '西极逐落日' },
        ],
    },
    themes: [
        { label: '大荒山林', heatMul: 1.0, itemMul: 1.0, trackTint: [58, 34, 20], curbTint: [255, 170, 90] },
        { label: '黄河渭水', heatMul: 0.7, itemMul: 1.2, trackTint: [46, 44, 52], curbTint: [110, 160, 190] },
        { label: '极西荒漠', heatMul: 1.6, itemMul: 0.8, trackTint: [120, 84, 40], curbTint: [230, 180, 100] },
        { label: '扶桑天境', heatMul: 1.2, itemMul: 1.4, trackTint: [140, 96, 36], curbTint: [255, 214, 120] },
    ],
    spawn: {
        rowInterval: 8, singleRowChance: 0.45, propInterval: 2.4,
        fragmentChance: 0.6, fragmentCount: 5, fragmentGap: 1.5, fragmentLead: 1.6,
        treeChance: 0.7, propSideMin: 1.55, propSideSpread: 0.9,
        propScaleMin: 0.8, propScaleSpread: 0.7,
    },
    obstacle: { hitZ: 0.55, pickupZFrom: -0.5, pickupZTo: 0.9 },
    death: { slowmo: 0.25, dieDelay: 0.95, dieRate: 2.8, slowmoRecover: 1.4, ambientRecover: 3 },
    milestone: { step: 1000, liScale: 3, skyRange: 30000 },
    ad: {
        mode: 'mock', timeoutMs: 15000,
        adUnitIds: { revive: '', doubleCoins: '', dailyDouble: '', timedPower: '', skinTrial: '' },
        interstitialUnitId: '',
        interstitial: { enabled: false, firstRunProtection: 1, cooldownMs: 180000, maxPerDay: 3 },
    },
    ui: {
        title: '逐 日', subtitle: '夸父逐日 · 神话跑酷',
        hintSwipe: '左右滑动变道 · 上滑跳跃 · 下滑俯冲', startBtn: '【 起 跑 】',
        deadTitle: '力 竭', reviveBtn: '▶ 观看广告 · 原地复活', restartBtn: '重新起跑',
        reviveNote: '复活每轮一次 · 真机接入 wx.createRewardedVideoAd',
        adTitle: '广告演示', adNote: '真实场景为 15-30 秒激励视频 · 看完才发奖',
        milestoneText: '日影渐近 · {n} 里', distLabel: '已逐 {n} 里', fragLabel: '阳炎 × {n}',
        deadDistLabel: '已逐日 {n} 里', deadFragLabel: '拾得阳炎 × {n}',
        speedLabel: '速度 {n}', stumbleText: '踉跄！',
        pausedTitle: '暂 停', resumeBtn: '继续奔跑',
        modeEndless: '无尽逐日', modeJourney: '逐日征途', bestLabel: '最佳 {n} 里',
        heatLabel: '暑 {n}', endedTitle: '逐日功成', endedSub: '弃其杖，化为邓林',
        stageLabel: '{label} · {n} 里',
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
    input: { swipeMin: { min: 1 }, tapMax: { min: 0 } },
    camera: { fovBase: { min: 20, max: 120 }, fovGain: { min: 0, max: 60 }, followLerp: { min: 0.1 }, heightFollow: { min: 0, max: 1 } },
    difficulty: { rampLi: { min: 100 }, minInterval: { min: 0.5 }, reactionGuard: { min: 0.05 }, reactionTime: { min: 0.05 } },
    heat: {
        baseRate: { min: 0.1 }, dScale: { min: 0, max: 3 }, warnAt: { min: 10, max: 100 },
        maxSlow: { min: 0.3, max: 1 }, waterReduce: { min: 1 }, streamReduce: { min: 0 },
        pityHeat: { min: 10, max: 99 }, pityDist: { min: 50 },
    },
    map: {
        seed: { integer: true, min: 0 }, horizon: { min: 60 }, recycleBehind: { min: 5 },
        straightMin: { min: 4 }, straightMax: { min: 4 },
        turnRadius: { min: 3 }, turnWindow: { min: 2 },
        turnGapMin: { min: 30 }, turnGapMax: { min: 30 },
        slopeChance: { min: 0, max: 1 }, slopeMin: { min: 5 }, slopeMax: { min: 5 },
        slopeGrade: { min: 0.01, max: 0.5 },
        bridgeChance: { min: 0, max: 1 }, cliffChance: { min: 0, max: 1 }, caveChance: { min: 0, max: 1 },
        specialGap: { min: 30 }, themeEvery: { min: 100 },
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
    for (const sec of ['renderMode', 'quality', 'world', 'speed', 'player', 'input', 'camera', 'map', 'difficulty', 'heat', 'journey', 'themes', 'spawn', 'obstacle', 'death', 'milestone', 'ad', 'ui']) {
        if (!hasOwn(obj, sec)) errs.push(`缺少字段 ${sec}`);
    }
    if (errs.length) return errs;

    // renderMode / ad.mode 枚举
    if (obj.renderMode !== '2d' && obj.renderMode !== '3d') errs.push(`renderMode 必须为 '2d'|'3d'，实际：${JSON.stringify(obj.renderMode)}`);
    const q = obj.quality as Record<string, unknown>;
    if (typeof q !== 'object' || q === null || !['low', 'mid', 'high'].includes(String(q.level))) {
        errs.push(`quality.level 必须为 'low'|'mid'|'high'，实际：${JSON.stringify(q)}`);
    }
    const pl = obj.player as Record<string, unknown>;
    const st = pl.stumble as Record<string, unknown> | undefined;
    if (typeof st !== 'object' || st === null) errs.push('player.stumble 必须是对象');
    else {
        if (typeof st.enabled !== 'boolean') errs.push('player.stumble.enabled 必须为布尔');
        for (const k of ['speedFactor', 'duration', 'mercyInvincible'] as const) {
            const v = st[k];
            if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`player.stumble.${k} 必须是有限数字`);
            else if (k === 'speedFactor' && (v <= 0 || v > 1)) errs.push(`player.stumble.speedFactor=${v} 必须在 (0,1]`);
            else if (k !== 'speedFactor' && v < 0) errs.push(`player.stumble.${k}=${v} 不能为负`);
        }
    }

    const ad = obj.ad as Record<string, unknown>;
    if (ad.mode !== 'mock' && ad.mode !== 'wx') errs.push(`ad.mode 必须为 'mock'|'wx'，实际：${JSON.stringify(ad.mode)}`);
    if (typeof ad.timeoutMs !== 'number' || ad.timeoutMs < 1000) errs.push('ad.timeoutMs 必须 ≥1000');
    // 广告位 ID 允许为空（未开通流量主时明确不可用），但必须是字符串；禁止在代码中编造 ID
    if (typeof ad.interstitialUnitId !== 'string') errs.push('ad.interstitialUnitId 必须为字符串');
    if (typeof ad.adUnitIds !== 'object' || ad.adUnitIds === null) errs.push('ad.adUnitIds 必须为对象');
    else {
        for (const [k, v] of Object.entries(ad.adUnitIds as Record<string, unknown>)) {
            if (typeof v !== 'string') errs.push(`ad.adUnitIds.${k} 必须为字符串`);
        }
    }
    const ia = ad.interstitial as Record<string, unknown> | undefined;
    if (typeof ia !== 'object' || ia === null) errs.push('ad.interstitial 缺失');
    else {
        if (typeof ia.enabled !== 'boolean') errs.push('ad.interstitial.enabled 必须为布尔');
        if (typeof ia.firstRunProtection !== 'number' || ia.firstRunProtection < 0) errs.push('firstRunProtection 非法');
        if (typeof ia.cooldownMs !== 'number' || ia.cooldownMs < 0) errs.push('cooldownMs 非法');
        if (typeof ia.maxPerDay !== 'number' || ia.maxPerDay < 0) errs.push('maxPerDay 非法');
    }
    // 合规：mode=wx 不代表已取得广告位；缺少 ID 时广告明确不可用（不伪造成功）

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

    // themes 数组
    const themes = obj.themes;
    if (!Array.isArray(themes) || themes.length < 1) errs.push('themes 必须为非空数组');
    else {
        for (const t of themes as unknown[]) {
            const d = t as Record<string, unknown>;
            if (typeof d.label !== 'string') errs.push('theme.label 必须为字符串');
            if (typeof d.heatMul !== 'number' || d.heatMul <= 0) errs.push('theme.heatMul 必须 >0');
            if (typeof d.itemMul !== 'number' || d.itemMul <= 0) errs.push('theme.itemMul 必须 >0');
            for (const tk of ['trackTint', 'curbTint'] as const) {
                if (!Array.isArray(d[tk]) || (d[tk] as unknown[]).length !== 3) errs.push(`theme.${tk} 必须为 [r,g,b]`);
            }
        }
    }
    // journey
    const journey = obj.journey as Record<string, unknown> | undefined;
    if (typeof journey !== 'object' || journey === null || !Array.isArray(journey.stages) || journey.stages.length < 1) {
        errs.push('journey.stages 必须为非空数组');
    } else {
        let prev = 0;
        for (const st of journey.stages as unknown[]) {
            const d = st as Record<string, unknown>;
            if (typeof d.goalLi !== 'number' || d.goalLi <= prev) errs.push('journey.stage.goalLi 必须递增');
            prev = typeof d.goalLi === 'number' ? d.goalLi : prev;
            if (typeof d.label !== 'string') errs.push('journey.stage.label 必须为字符串');
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
        if (c.map.turnGapMin > c.map.turnGapMax) errs.push('map.turnGapMin 必须小于等于 turnGapMax');
        if (c.map.straightMin > c.map.straightMax) errs.push('map.straightMin 必须小于等于 straightMax');
        if (c.map.slopeMin > c.map.slopeMax) errs.push('map.slopeMin 必须小于等于 slopeMax');
        if (c.map.horizon <= c.map.recycleBehind * 2) errs.push('map.horizon 必须显著大于 recycleBehind');
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
