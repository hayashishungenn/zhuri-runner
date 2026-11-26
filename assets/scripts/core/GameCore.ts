/**
 * GameCore —— 核心玩法状态机与全部规则（唯一规则真源）。
 * 纯 TypeScript，零 cc 依赖：可在 Node 单测，也可对接任意渲染器。
 *
 * Phase 8.1 核心架构约定：
 * 1. 固定时间步长：FIXED_DT = 1/60s，累加器驱动，单帧上限 MAX_FRAME_DT = 0.25s，
 *    单帧最大步数 MAX_SUB_STEPS = 8；暴露 renderAlpha 与上一逻辑帧快照供渲染插值。
 * 2. 坐标语义统一：
 *    - 绝对路径距离 absD = dist + relZ（地图/安全区/转弯路口/可达性统一使用 absD）
 *    - 相对玩家距离 relZ = absD - dist（实体 z：spawnZ 出现、0 为玩家、despawnZ 回收）
 *    - 提供 toAbsD / toRelZ 显式转换，禁止混用。
 * 3. 连续运动与扫描碰撞：基于 [prevZ, currZ] 区间与角色宽度/跳跃高度/滑铲高度做连续判定，防高速穿透。
 * 4. 独立随机流：单局主种子 runSeed 派生 map / obstacle / drop / decor 4 条独立 PRNG 流。
 * 5. 单局模式参数：通过 RunModeOverrides 注入，绝不修改共享 GameConfig。
 */
import { GameConfig, ThemeCfg } from '../config/GameConfigSchema';
import { ObstacleCatalog, ObstacleDef, defaultCatalog } from '../config/ObstacleCatalog';
import { validateReachability, abilityForSpeed, ObstacleEvent } from './Reachability';
import { Rng, SeededRng, RNG_STREAM, deriveSeed } from './rng';
import { SimulationClock } from './SimulationClock';
import { COLLISION_GEOM, evaluateObstacleSweep, evaluatePickupSweep, jumpHeightAt } from './CollisionSystem';
import {
    Obstacle, ItemKind, ItemEntity, Fragment, Prop, GameState, CoreEvent,
    RunModeOverrides, StartRunOptions, CoreCommand, ReadonlyCoreView, CoreResourceStats,
} from './types';
import { MapGenerator, Corner } from './MapGenerator';

export class GameCore {
    /** 固定逻辑步长（60 Hz，代理自 SimulationClock） */
    static readonly FIXED_DT = SimulationClock.FIXED_DT;
    /** 单帧输入 dt 上限（代理自 SimulationClock） */
    static readonly MAX_FRAME_DT = SimulationClock.MAX_FRAME_DT;
    /** 单次 update 最大逻辑子步数（代理自 SimulationClock） */
    static readonly MAX_SUB_STEPS = SimulationClock.MAX_SUB_STEPS;

    /** 连续碰撞几何常量（代理自 CollisionSystem，与碰撞和可达性同源） */
    static readonly PLAYER_HALF_WIDTH = COLLISION_GEOM.PLAYER_HALF_WIDTH;
    static readonly OBS_HALF_WIDTH = COLLISION_GEOM.OBS_HALF_WIDTH;
    static readonly PICKUP_HALF_WIDTH = COLLISION_GEOM.PICKUP_HALF_WIDTH;
    static readonly PLAYER_STAND_HEIGHT = COLLISION_GEOM.PLAYER_STAND_HEIGHT;
    static readonly PLAYER_SLIDE_HEIGHT = COLLISION_GEOM.PLAYER_SLIDE_HEIGHT;
    static readonly JUMP_HEIGHT_BASE = COLLISION_GEOM.JUMP_HEIGHT_BASE;
    static readonly JUMP_HEIGHT_LEAP = COLLISION_GEOM.JUMP_HEIGHT_LEAP;
    static readonly OBS_HIT_Z_BACK = COLLISION_GEOM.OBS_HIT_Z_BACK;
    static readonly JUMP_CLEAR_HEIGHT = COLLISION_GEOM.JUMP_CLEAR_HEIGHT;

    readonly cfg: GameConfig;

    // ---- 固定时间步与时钟管理（SimulationClock 唯一持有） ----
    readonly clock = new SimulationClock();
    get fixedTick(): number { return this.clock.fixedTick; }
    set fixedTick(v: number) { this.clock.fixedTick = v; }
    get gTime(): number { return this.clock.gTime; }
    set gTime(v: number) { this.clock.gTime = v; }
    get runTime(): number { return this.clock.runTime; }
    set runTime(v: number) { this.clock.runTime = v; }
    get renderAlpha(): number { return this.clock.renderAlpha; }
    set renderAlpha(v: number) { this.clock.renderAlpha = v; }
    get paused(): boolean { return this.clock.paused; }
    set paused(v: boolean) { this.clock.paused = v; }

    prevDist = 0;
    prevPlayerLaneF = 0;
    prevJumpT = -1;
    /** 可选逻辑帧前采样钩子（用于确定性回放或固定步长输入消费） */
    onBeforeStep: ((core: GameCore) => void) | null = null;
    private commandQueue: CoreCommand[] = [];
    private lastEmittedThemeIdx = 0;

    // ---- 运行时状态（渲染器通过 core.view 只读访问） ----
    state: GameState = 'title';
    timeScale = 1;          // 慢动作系数
    dist = 0;               // 逻辑距离（绝对路径位置，里 = dist * liScale）
    frags = 0;              // 阳炎计数
    speed: number;          // 速度公式值（不含踉跄减速）
    runPhase = 0;           // 跑步动画相位
    playerLaneF = 0;        // 当前车道（浮点，连续缓动）
    targetLane = 0;
    jumpT = -1;             // [-1]未跳；[0,1)跳跃进度
    slideT = -1;            // [-1]未俯冲；[0,slideDuration]剩余时间
    invincible = 0;         // 无敌剩余时间（复活/踉跄豁免/冲刺共用）
    reviveUsed = false;
    milestone: number;
    dieTimer = -1;
    stumbleTimer = 0;       // 踉跄剩余时间（>0 即踉跄中）

    obstacles: Obstacle[] = [];
    fragments: Fragment[] = [];
    props: Prop[] = [];
    items: ItemEntity[] = [];

    // ---- Phase 3 道具状态 ----
    magnetT = 0;            // 磁吸剩余
    dashT = 0;              // 冲刺剩余（冲刺期间无敌）
    doubleT = 0;            // 倍率剩余
    shieldCharges = 0;      // 护盾层数（0/1）
    staffCharges = 0;       // 桃木神杖层数（破坏切道/时机类障碍，0-6+强化）
    leapT = 0;              // 巨人之跃剩余（跳跃更久更高）
    // ---- Phase 4 高温与逐日 ----
    heat = 0;               // 热量 [0,100]（100 不死：强制减速 maxSlow）
    maxHeat = 0;            // 本局达到的最高热量（用于 coolRuns 成就精确判定）
    lastWaterD = 0;         // 上次饮水资源出现/拾取的里程（保底用）
    // ---- Phase 4 游戏模式与征途 ----
    mode: 'endless' | 'journey' = 'endless';
    journeyStage = 0;       // 已完成的征途阶段数
    // ---- Phase 6 强化效果（由 Game 装配时注入；0 = 无强化） ----
    mods = { staffCapBonus: 0, waterReduceBonus: 0, magnetBonus: 0, heatResist: 1, goldMul: 1 };

    /** 单局主随机种子（用于可复现重放） */
    runSeed: number;
    private readonly baseSeed: number;
    private obstacleRng!: Rng;
    private dropRng!: Rng;
    private decorRng!: Rng;
    private runOverrides: RunModeOverrides | null = null;

    /** 当前主题索引（渲染/统计共用） */
    get themeIdx(): number { return this.path.segmentAt(this.dist).theme; }
    /** 当前难度 [0,1]（里程驱动，封顶） */
    get difficulty(): number { return Math.min(this.li / this.cfg.difficulty.rampLi, 1); }

    private spawnAcc: number;
    private propAcc = 0;
    private events: CoreEvent[] = [];
    private slowFactor = 1;     // 减速倍率（踉跄等触发）
    private slowTimer = 0;
    private lastWaveEvents: ObstacleEvent[] = [];

    /** 可达性验证统计 */
    readonly waveStats = { validated: 0, rejected: 0 };
    readonly spawnDebug = {
        calls: 0, zoneBlocks: 0, patternSpawned: 0, fallbackSpawned: 0,
        fullRejects: 0, fragRows: 0, fragLanes: [] as number[], itemCount: 0, pityFires: 0,
    };

    // ---- Phase 2：无限地图与转弯 ----
    readonly mapGen: MapGenerator;
    /** 世界空间路径（渲染层采样用；玩家 dist 即其在路径上的位置） */
    get path() { return this.mapGen.path; }
    /** 转弯操作窗口（null = 无窗口）；d 为路口判定点绝对距离 */
    turnWindow: { dir: 1 | -1; d: number } | null = null;
    cornersPassed = 0;

    readonly catalog: ObstacleCatalog;
    private defMap = new Map<string, ObstacleDef>();

    constructor(
        cfg: GameConfig,
        rng?: Rng,
        opts?: { turnsEnabled?: boolean; catalog?: ObstacleCatalog; mode?: 'endless' | 'journey'; seed?: number },
    ) {
        this.cfg = cfg;
        if (opts?.mode) this.mode = opts.mode;
        this.baseSeed = opts?.seed ?? (rng instanceof SeededRng ? rng.initialSeed : cfg.map.seed);
        this.runSeed = this.baseSeed;
        this.speed = cfg.speed.base;
        this.milestone = cfg.milestone.step;
        this.spawnAcc = cfg.spawn.rowInterval * 0.5;
        this.catalog = opts?.catalog ?? defaultCatalog();
        for (const d of this.catalog.obstacles) this.defMap.set(d.id, d);
        this.mapGen = new MapGenerator({
            ...cfg.map,
            turnsEnabled: opts?.turnsEnabled ?? false,
        });
        this.initRngStreams(this.runSeed);
        this.mapGen.reset(deriveSeed(this.runSeed, RNG_STREAM.MAP));
        this.mapGen.update(0);
    }

    /** 统一坐标转换：相对玩家距离 → 绝对路径距离 */
    toAbsD(relZ: number): number { return this.dist + relZ; }
    /** 统一坐标转换：绝对路径距离 → 相对玩家距离 */
    toRelZ(absD: number): number { return absD - this.dist; }

    /** 渲染插值位置（基于 renderAlpha） */
    get interpDist(): number { return this.prevDist + (this.dist - this.prevDist) * this.renderAlpha; }
    get interpPlayerLaneF(): number { return this.prevPlayerLaneF + (this.playerLaneF - this.prevPlayerLaneF) * this.renderAlpha; }
    get interpJumpT(): number {
        if (this.jumpT < 0 || this.prevJumpT < 0) return this.jumpT;
        return this.prevJumpT + (this.jumpT - this.prevJumpT) * this.renderAlpha;
    }

    /** 玩家当前离地高度（连续） */
    get playerY(): number { return jumpHeightAt(this.jumpT, this.leapT > 0); }
    /** 玩家当前身高（站立 1.8 / 滑铲 0.75） */
    get playerHeight(): number { return this.slideT >= 0 ? COLLISION_GEOM.PLAYER_SLIDE_HEIGHT : COLLISION_GEOM.PLAYER_STAND_HEIGHT; }
    /** 本局是否全程未触发过热警戒 */
    get isCoolRun(): boolean { return this.maxHeat < this.cfg.heat.warnAt; }

    /** 只读视图（零深拷贝，供渲染层/HUD/统计只读消费） */
    get view(): ReadonlyCoreView { return this; }

    /** 开发期核心逻辑资源计数（用于长跑/重开内存与对象有界观测） */
    getResourceStats(): CoreResourceStats {
        return {
            segments: this.mapGen.path.segments.length,
            corners: this.mapGen.corners.length,
            obstacles: this.obstacles.length,
            fragments: this.fragments.length,
            items: this.items.length,
            props: this.props.length,
            pendingEvents: this.events.length,
            queuedCommands: this.commandQueue.length,
        };
    }

    /** 统一事件发射器：自动附加 runId 与逻辑帧 tick */
    private emit(ev: CoreEvent): void {
        this.events.push({ ...ev, runId: this.runSeed, tick: this.fixedTick });
    }

    /** 提交输入命令至逻辑帧队列（在下一个固定逻辑步首消费；用于统一输入与确定性回放） */
    enqueueCommand(cmd: CoreCommand): void {
        this.commandQueue.push(cmd);
    }

    /** 立即执行单条核心命令 */
    applyCommand(cmd: CoreCommand): void {
        switch (cmd.type) {
        case 'lane': this.doLane(cmd.dir); break;
        case 'jump': this.doJump(); break;
        case 'slide': this.doSlide(); break;
        case 'turn': this.tryTurn(cmd.dir); break;
        case 'pause': this.pause(); break;
        case 'resume': this.resume(); break;
        }
    }

    private flushCommands(): void {
        if (!this.commandQueue.length) return;
        const cmds = this.commandQueue;
        this.commandQueue = [];
        for (const cmd of cmds) this.applyCommand(cmd);
    }

    private initRngStreams(seed: number): void {
        this.runSeed = seed >>> 0;
        this.obstacleRng = new SeededRng(deriveSeed(this.runSeed, RNG_STREAM.OBSTACLE));
        this.dropRng = new SeededRng(deriveSeed(this.runSeed, RNG_STREAM.DROP));
        this.decorRng = new SeededRng(deriveSeed(this.runSeed, RNG_STREAM.DECOR));
    }

    private defOf(o: Obstacle): ObstacleDef {
        const d = this.defMap.get(o.defId);
        if (!d) throw new Error(`未知障碍 defId: ${o.defId}`);
        return d;
    }

    /** 障碍当前占道（timing 障碍按相位计算，并回写 lane/visLane 供渲染/碰撞同源） */
    obstacleLanes(o: Obstacle): number[] {
        const def = this.defOf(o);
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        if (def.osc) {
            const half = def.osc.period / 2;
            const idx = Math.floor((this.runTime + o.phase) / half) % 2;
            o.lane = def.osc.lanes[idx];
            return this.expandLanes(o.lane, def.lanes);
        }
        if (def.rollSpeed) {
            const pos = ((this.runTime * def.rollSpeed + o.phase) % 2.4) - 1.2;
            o.visLane = clamp(pos);
            o.lane = clamp(Math.round(pos));
            return [o.lane];
        }
        return this.expandLanes(o.lane, def.lanes);
    }

    /** 锚点车道扩展为占道集合（占道数 n，向右扩展并 clamp） */
    private expandLanes(anchor: number, n: number): number[] {
        if (n <= 1) return [anchor];
        const out = [anchor];
        let r = anchor;
        while (out.length < n) {
            r = r + 1;
            if (r > 1) { r = anchor - 1; }
            if (r < -1) break;
            if (!out.includes(r)) out.push(r);
            else break;
        }
        return out.sort((a, b) => a - b);
    }

    get laneMax(): number { return Math.floor(this.cfg.world.laneCount / 2); }
    /** 里程（里） */
    get li(): number { return this.dist * this.cfg.milestone.liScale; }
    /** 天色进度 [0,1]（skyRange 里为全程） */
    get skyP(): number { return Math.min(this.li / this.cfg.milestone.skyRange, 1); }
    reviveUsable(): boolean { return !this.reviveUsed; }
    /** 空中状态（跳跃进行中） */
    get airborne(): boolean { return this.jumpT >= 0; }
    /** 踉跄中（受击后的减速与濒危窗口） */
    get stumbling(): boolean { return this.stumbleTimer > 0; }
    /** 实际推进速度 = 速度公式 × 减速倍率 ×（冲刺 1.5）×（热满减速） */
    get effectiveSpeed(): number {
        const base = this.speed * (this.slowTimer > 0 ? this.slowFactor : 1);
        const dashed = this.dashT > 0 ? base * 1.5 : base;
        return this.heat >= this.cfg.heat.warnAt ? dashed * this.cfg.heat.maxSlow : dashed;
    }

    /** 当前跳跃时长（巨人之跃期间 ×1.35：更久更高，跨越能力提升） */
    get jumpDurNow(): number {
        return this.cfg.player.jumpDuration * (this.leapT > 0 ? 1.35 : 1);
    }

    /** 当前主题配置（按路径所在地块的主题索引） */
    get themeNow(): ThemeCfg {
        const seg = this.mapGen.path.segmentAt(this.dist);
        const list = this.cfg.themes;
        return list[seg.theme % list.length];
    }

    /** 逐日进度 [0,1]：无尽 = 里程/天空全程；征途 = 里程/最终目标 */
    get sunProgress(): number {
        if (this.mode === 'journey') {
            const final = this.cfg.journey.stages[this.cfg.journey.stages.length - 1];
            return Math.min(this.li / final.goalLi, 1);
        }
        return this.skyP;
    }

    drainEvents(): CoreEvent[] {
        const out = this.events;
        this.events = [];
        return out;
    }

    /** 设置或清除单局模式参数（例如教程完成时立即恢复正常生成，不修改共享 cfg） */
    setRunOverrides(overrides: RunModeOverrides | null): void {
        this.runOverrides = overrides ? { ...overrides } : null;
        this.mapGen.setOverrides(this.runOverrides ? {
            turnsEnabled: this.runOverrides.turnsEnabled,
            turnGapMin: this.runOverrides.turnGapMin,
            turnGapMax: this.runOverrides.turnGapMax,
        } : null);
    }

    /** 当前生效的单局覆写（只读） */
    get activeOverrides(): Readonly<RunModeOverrides> | null { return this.runOverrides; }

    /** 后台恢复时清空未消费的帧时间累加器，防止切回前台瞬间爆发追帧 */
    onBackgroundResume(): void {
        this.clock.onBackgroundResume();
    }

    // ---------- 流程 ----------
    startRun(opts?: StartRunOptions) {
        if (opts?.mode) this.mode = opts.mode;
        this.setRunOverrides(opts?.overrides ?? null);
        this.reset(opts?.seed);
        if (opts?.startBuffs) {
            if (opts.startBuffs.magnetT && opts.startBuffs.magnetT > 0) {
                this.magnetT = Math.max(this.magnetT, opts.startBuffs.magnetT);
            }
            if (opts.startBuffs.dashT && opts.startBuffs.dashT > 0) {
                this.dashT = Math.max(this.dashT, opts.startBuffs.dashT);
                this.invincible = Math.max(this.invincible, this.dashT);
            }
        }
        this.state = 'run';
        this.emit({ type: 'runStart' });
    }

    /** 返回主菜单（标题态）：重置单局覆写与运行态 */
    returnToTitle(): void {
        this.setRunOverrides(null);
        this.reset();
        this.state = 'title';
    }

    /** 暂停（仅 run 状态；冻结整帧推进，gTime 一并冻结） */
    pause() {
        if (this.state === 'run' && !this.clock.paused) {
            this.clock.pause();
            this.emit({ type: 'pause' });
        }
    }

    resume() {
        if (this.state === 'run' && this.clock.paused) {
            this.clock.resume();
            this.emit({ type: 'resume' });
        }
    }

    /**
     * 减速接口：踉跄/后续减速带等触发。factor ∈ (0,1]，duration 秒。
     * 重复调用取更缓的倍率与更长的剩余时间。
     */
    applySlowdown(factor: number, duration: number) {
        if (factor <= 0 || factor > 1 || duration <= 0) {
            throw new Error(`applySlowdown 非法参数 factor=${factor} duration=${duration}`);
        }
        this.slowFactor = Math.min(this.slowFactor, factor);
        this.slowTimer = Math.max(this.slowTimer, duration);
    }

    /**
     * 路口转向（Phase 2）。仅在转弯窗口内有效：
     * 方向正确 → 通过路口；方向错误 → 标记路口已消费并撞墙死亡（复活后不会因旧窗口再次死亡）。
     */
    tryTurn(dir: 1 | -1): boolean {
        if (this.state !== 'run' || this.paused || !this.turnWindow) return false;
        const c = this.findCorner(this.turnWindow.d);
        if (dir === this.turnWindow.dir) {
            if (c) c.passed = true;
            this.cornersPassed++;
            this.emit({ type: 'turnOk' });
            this.turnWindow = null;
            return true;
        }
        // 转错方向：标记该路口已结束，清空窗口，冲出跑道
        if (c) c.passed = true;
        this.turnWindow = null;
        this.emit({ type: 'turnMiss' });
        this.crash();
        return false;
    }

    private findCorner(d: number): Corner | undefined {
        return this.mapGen.corners.find((c) => Math.abs(c.d - d) < 0.5);
    }

    /** 死亡结算后的复活（广告发奖回调触发）；异步回调到达时必须重新校验状态 */
    revive(): boolean {
        if (this.reviveUsed || this.state !== 'dead') return false;
        this.reviveUsed = true;
        // 清除近处障碍（z <= reviveKeepZ），保留远景；同步剪除对应的历史波事件
        this.obstacles = this.obstacles.filter((o) => o.z > this.cfg.player.reviveKeepZ);
        const safeCornerD = this.dist + this.cfg.player.reviveKeepZ;
        this.lastWaveEvents = this.lastWaveEvents.filter((e) => e.d > safeCornerD);
        // 清理已过或位于复活保护区内的路口，避免旧路口阻塞或复活瞬间再次撞墙
        for (const c of this.mapGen.corners) {
            if (c.d <= safeCornerD) c.passed = true;
        }
        this.turnWindow = null;
        this.invincible = this.cfg.player.reviveInvincible;
        this.stumbleTimer = 0;
        this.slowTimer = 0; this.slowFactor = 1;
        this.jumpT = -1; this.slideT = -1;
        this.dieTimer = -1;
        this.clock.onBackgroundResume();
        this.prevDist = this.dist;
        this.prevPlayerLaneF = this.playerLaneF;
        this.prevJumpT = -1;
        this.state = 'run';
        this.timeScale = 1;
        this.emit({ type: 'revive' });
        return true;
    }

    private reset(seed?: number) {
        const c = this.cfg;
        this.clock.resetRun();
        this.commandQueue = [];
        this.lastEmittedThemeIdx = 0;
        this.playerLaneF = 0; this.targetLane = 0;
        this.prevDist = 0; this.prevPlayerLaneF = 0; this.prevJumpT = -1;
        this.jumpT = -1; this.slideT = -1; this.runPhase = 0;
        this.dist = 0; this.frags = 0; this.speed = c.speed.base;
        this.obstacles = []; this.fragments = []; this.props = [];
        const baseInterval = this.runOverrides?.spawnRowInterval ?? c.spawn.rowInterval;
        this.spawnAcc = baseInterval * 0.5;
        this.propAcc = 0;
        this.dieTimer = -1;
        this.reviveUsed = false; this.invincible = 0;
        this.milestone = c.milestone.step; this.timeScale = 1;
        this.stumbleTimer = 0;
        this.slowFactor = 1; this.slowTimer = 0;
        this.items = [];
        this.magnetT = 0; this.dashT = 0; this.doubleT = 0; this.shieldCharges = 0;
        this.staffCharges = 0; this.leapT = 0;
        this.heat = 0; this.maxHeat = 0; this.lastWaterD = 0;
        this.journeyStage = 0;
        this.lastWaveEvents = [];
        this.events = [];
        this.waveStats.validated = 0;
        this.waveStats.rejected = 0;
        this.spawnDebug.calls = 0;
        this.spawnDebug.zoneBlocks = 0;
        this.spawnDebug.patternSpawned = 0;
        this.spawnDebug.fallbackSpawned = 0;
        this.spawnDebug.fullRejects = 0;
        this.spawnDebug.fragRows = 0;
        this.spawnDebug.fragLanes = [];
        this.spawnDebug.itemCount = 0;
        this.spawnDebug.pityFires = 0;
        // 主种子派生 4 条独立随机流并重建无限地图（含 difficulty 归零）
        this.initRngStreams(seed ?? this.baseSeed);
        this.mapGen.reset(deriveSeed(this.runSeed, RNG_STREAM.MAP));
        this.mapGen.update(0);
        this.turnWindow = null;
        this.cornersPassed = 0;
    }

    // ---------- 输入意图 ----------
    // 动作优先级（Phase 1 规则化）：
    //   dying/dead/ended/paused/title：不受理任何玩法输入
    //   run：变道 ✓ 跳 ✓（仅地面、无二段跳）滑铲 ✓
    //   空中：变道 ✓ 滑铲 ✓（俯冲斩断跳跃）跳 ✗
    //   滑铲中：变道 ✓ 跳 ✓（起跳取消滑铲）滑铲 ✓（重置时长）
    doLane(dir: number) {
        if (this.state !== 'run' || this.paused) return;
        this.targetLane = Math.max(-this.laneMax, Math.min(this.laneMax, this.targetLane + dir));
    }
    doJump() {
        if (this.state !== 'run' || this.paused) return;
        if (this.jumpT < 0) {
            this.jumpT = 0;
            this.slideT = -1;          // 起跳取消滑铲
            this.emit({ type: 'jump' });
        }
    }
    doSlide() {
        if (this.state !== 'run' || this.paused) return;
        if (this.jumpT >= 0) this.jumpT = this.cfg.player.diveJumpTo;
        const wasSliding = this.slideT >= 0;
        this.slideT = this.cfg.player.slideDuration;
        if (!wasSliding) this.emit({ type: 'slideStart' });
    }

    // ---------- 固定时间步长主循环（委托 SimulationClock） ----------
    update(dtRaw: number) {
        this.clock.advance(dtRaw, (dt) => this.stepFixed(dt));
    }

    /** 单次固定逻辑步推进（确定性核心） */
    private stepFixed(dt: number) {
        if (this.onBeforeStep) this.onBeforeStep(this);
        this.flushCommands();
        this.prevDist = this.dist;
        this.prevPlayerLaneF = this.playerLaneF;
        this.prevJumpT = this.jumpT;

        if (this.state === 'run') {
            this.clock.advanceRunTime(dt * this.timeScale);
            this.updateRun(dt * this.timeScale);
            if ((this.state as GameState) !== 'dying') {
                this.recoverTimeScale(dt, this.cfg.death.ambientRecover);
            }
        } else if (this.state === 'dying') {
            this.updateDying(dt * this.timeScale);
        } else {
            this.recoverTimeScale(dt, this.cfg.death.ambientRecover);
        }
    }

    private recoverTimeScale(dt: number, rate: number) {
        this.timeScale += (1 - this.timeScale) * Math.min(1, dt * rate);
    }

    private updateRun(dt: number) {
        const c = this.cfg;
        this.speed = c.speed.base + Math.min(this.dist * c.speed.gain, c.speed.gainCap);
        const spd = this.effectiveSpeed;

        // 无限地图：前方预生成 / 身后回收；转弯窗口状态更新
        this.mapGen.update(this.dist);
        this.updateTurnWindow();
        // 若错过转弯已触发死亡，立即中止本帧后续玩法逻辑（防止同帧推进距离或触发通关）
        if ((this.state as GameState) !== 'run') return;

        // 踉跄/减速/道具计时（浮点残差防护）
        if (this.stumbleTimer > 0) {
            this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
            if (this.stumbleTimer < 1e-9) this.stumbleTimer = 0;
        }
        if (this.slowTimer > 0) {
            this.slowTimer = Math.max(0, this.slowTimer - dt);
            if (this.slowTimer < 1e-9) { this.slowTimer = 0; this.slowFactor = 1; }
        }
        if (this.magnetT > 0) {
            this.magnetT = Math.max(0, this.magnetT - dt);
            if (this.magnetT < 1e-9) this.magnetT = 0;
        }
        if (this.doubleT > 0) {
            this.doubleT = Math.max(0, this.doubleT - dt);
            if (this.doubleT < 1e-9) this.doubleT = 0;
        }
        if (this.leapT > 0) {
            this.leapT = Math.max(0, this.leapT - dt);
            if (this.leapT < 1e-9) this.leapT = 0;
        }
        if (this.dashT > 0) {
            this.dashT = Math.max(0, this.dashT - dt);
            if (this.dashT < 1e-9) this.dashT = 0;
            this.invincible = Math.max(this.invincible, this.dashT);
        }

        const prevLaneF = this.playerLaneF;
        const prevJumpT = this.jumpT;
        const prevSlideT = this.slideT;

        this.dist += spd * dt;
        // 高温：随难度与主题升温，封顶 100（永不致死——热满仅强制减速 maxSlow）
        if (this.heat < 100) {
            const themeMul = this.themeNow.heatMul;
            this.heat = Math.min(100, this.heat + c.heat.baseRate * themeMul * (1 + c.heat.dScale * this.difficulty) * this.mods.heatResist * dt);
        }
        if (this.heat > this.maxHeat) this.maxHeat = this.heat;

        // 单帧跨越多个里程碑逐次补发
        while (this.li >= this.milestone) {
            this.emit({ type: 'milestone', n: this.milestone });
            this.milestone += c.milestone.step;
        }
        // 主题切换事件（领域事件唯一真源）
        const curTheme = this.themeIdx;
        if (curTheme !== this.lastEmittedThemeIdx) {
            this.lastEmittedThemeIdx = curTheme;
            this.emit({ type: 'themeChange', themeIdx: curTheme });
        }
        // 征途阶段与通关（仅征途模式）
        if (this.mode === 'journey') {
            const stages = c.journey.stages;
            while (this.journeyStage < stages.length && this.li >= stages[this.journeyStage].goalLi) {
                const st = stages[this.journeyStage];
                this.journeyStage++;
                this.emit({ type: 'stage', n: this.journeyStage, label: st.label });
            }
            if (this.journeyStage >= stages.length) {
                this.state = 'ended';
                this.turnWindow = null;
                this.emit({ type: 'journeyDone' });
                return;
            }
        }
        if (this.invincible > 0) {
            this.invincible = Math.max(0, this.invincible - dt);
            if (this.invincible < 1e-9) this.invincible = 0;
        }
        this.playerLaneF += (this.targetLane - this.playerLaneF) * Math.min(1, dt * c.player.laneLerp);
        if (this.jumpT >= 0) {
            this.jumpT += dt / this.jumpDurNow;
            if (this.jumpT >= 1) { this.jumpT = -1; this.emit({ type: 'land' }); }
        }
        if (this.slideT >= 0) { this.slideT -= dt; if (this.slideT < 0) this.slideT = -1; }
        this.runPhase += dt * (6 + spd * 0.35);

        // 地图生成难度联动（转弯频率随难度提升）
        this.mapGen.difficulty = this.difficulty;

        // ---- 障碍推进 + 连续扫描碰撞判定（委托 CollisionSystem） ----
        const hitZFront = c.obstacle.hitZ;
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            const prevZ = o.z;
            o.z -= spd * dt;
            const currZ = o.z;
            if (currZ < c.world.despawnZ) { this.obstacles.splice(i, 1); continue; }

            const def = this.defOf(o);
            if (def.pass === 'timing') this.obstacleLanes(o);
            if (o.passed) continue;

            const lanes = this.obstacleLanes(o);
            const effPass = (def.pass === 'timing' ? (def.rollSpeed ? 'jump' : 'lane') : def.pass) as 'jump' | 'slide' | 'lane';
            const sweep = evaluateObstacleSweep({
                prevZ, currZ, hitZFront,
                prevLaneF, currLaneF: this.playerLaneF,
                prevJumpT, currJumpT: this.jumpT,
                prevSlideT, currSlideT: this.slideT,
                jumpSafeFrom: c.player.jumpSafeFrom,
                jumpSafeTo: c.player.jumpSafeTo,
                leapActive: this.leapT > 0,
                effPass,
                lanes,
                continuousLane: def.rollSpeed ? o.visLane : undefined,
            });
            if (!sweep.crossed) continue;

            o.passed = true;
            const { lateralHit, safe } = sweep;

            // 桃木神杖：仅非无敌期撞上切道/时机类障碍时消耗 1 层将其击碎
            if (!safe && this.invincible <= 0 && this.staffCharges > 0 && (def.pass === 'lane' || def.pass === 'timing')) {
                this.staffCharges--;
                this.invincible = Math.max(this.invincible, 0.8);
                o.z = -3;
                this.emit({ type: 'staffBreak' });
                continue;
            }
            if (!safe && this.invincible <= 0 && this.shieldCharges > 0) {
                this.shieldCharges--;
                this.invincible = Math.max(this.invincible, 1.2);
                o.z = -3;
                this.emit({ type: 'shieldBreak' });
                continue;
            }
            if (!safe && this.invincible <= 0) {
                const canStumble = c.player.stumble.enabled && def.damage === 'stumble' && !this.stumbling;
                if (canStumble) {
                    this.stumbleTimer = c.player.stumble.duration;
                    this.invincible = c.player.stumble.mercyInvincible;
                    this.applySlowdown(c.player.stumble.speedFactor, c.player.stumble.duration);
                    o.z = -3;
                    this.emit({ type: 'stumble' });
                } else {
                    this.crash();
                    return;
                }
            }
            if (!safe && this.invincible > 0 && o.z !== -3) {
                o.z = -3;
                this.emit({ type: 'obstacleSmashed' });
            } else if (safe && lateralHit) {
                this.emit({ type: 'obstaclePassed' });
                if (def.vis === 'water') {
                    this.heat = Math.max(0, this.heat - c.heat.streamReduce);
                    this.emit({ type: 'cool', amount: c.heat.streamReduce });
                }
            }
        }

        // ---- 道具拾取（委托 CollisionSystem 连续扫描）----
        const pickFrom = c.obstacle.pickupZFrom;
        const pickTo = c.obstacle.pickupZTo;
        for (let i = this.items.length - 1; i >= 0; i--) {
            const it = this.items[i];
            const prevZ = it.z;
            it.z -= spd * dt;
            const currZ = it.z;
            if (currZ < c.world.despawnZ) { this.items.splice(i, 1); continue; }
            if (!it.got && evaluatePickupSweep({
                prevZ, currZ, pickFrom, pickTo,
                prevLaneF, currLaneF: this.playerLaneF,
                targetLane: it.lane,
            })) {
                it.got = true;
                this.pickItem(it.kind);
                this.emit({ type: 'item', kind: it.kind, lane: it.lane });
                this.items.splice(i, 1);
            }
        }

        // ---- 磁吸：近处碎片吸附到玩家车道 ----
        if (this.magnetT > 0) {
            const snapLane = Math.round(this.playerLaneF);
            for (const f of this.fragments) {
                if (!f.got && f.z > 0 && f.z < 8) f.lane = snapLane;
            }
        }

        // ---- 阳炎拾取（委托 CollisionSystem 连续扫描）----
        for (let i = this.fragments.length - 1; i >= 0; i--) {
            const f = this.fragments[i];
            const prevZ = f.z;
            f.z -= spd * dt;
            const currZ = f.z;
            if (currZ < c.world.despawnZ) { this.fragments.splice(i, 1); continue; }
            if (!f.got && evaluatePickupSweep({
                prevZ, currZ, pickFrom, pickTo,
                prevLaneF, currLaneF: this.playerLaneF,
                targetLane: f.lane,
            })) {
                f.got = true;
                const amount = this.doubleT > 0 ? 2 : 1;
                this.frags += amount;
                this.emit({ type: 'fragment', lane: f.lane, amount });
            }
        }

        for (let i = this.props.length - 1; i >= 0; i--) {
            this.props[i].z -= spd * dt;
            if (this.props[i].z < c.world.despawnZ) this.props.splice(i, 1);
        }

        // 在既有实体推进完成后再生成新波与装饰（避免同帧立刻扣减 spd*dt 造成 1-tick absD 偏移）
        this.spawnAcc += spd * dt;
        const rowInt = this.rowIntervalNow();
        while (this.spawnAcc >= rowInt) {
            this.spawnAcc -= rowInt;
            this.spawnWave();
        }
        this.propAcc += spd * dt;
        while (this.propAcc >= c.spawn.propInterval) {
            this.propAcc -= c.spawn.propInterval;
            this.spawnProp();
        }
    }

    /** 转弯窗口状态机：进入窗口开启；越过路口未转向 → 标记路口已消费并撞墙 */
    private updateTurnWindow() {
        const W = this.cfg.map.turnWindow;
        if (this.turnWindow) {
            const corner = this.findCorner(this.turnWindow.d);
            if (corner?.passed) { this.turnWindow = null; return; }
            if (this.dist > this.turnWindow.d + 0.6) {
                // 错过转弯：标记路口已结束，清空窗口，触发死亡（复活后不再被旧路口阻塞）
                if (corner) corner.passed = true;
                this.turnWindow = null;
                this.emit({ type: 'turnMiss' });
                this.crash();
            }
            return;
        }
        // 仅查找未通过且尚未完全越过的未来路口
        const next = this.mapGen.corners.find((c) => !c.passed && c.d + 0.6 >= this.dist);
        if (next && this.dist >= next.d - W && this.dist <= next.d + 0.6) {
            this.turnWindow = { dir: next.dir, d: next.d };
        }
    }

    private updateDying(dt: number) {
        const c = this.cfg.death;
        this.timeScale += (1 - this.timeScale) * Math.min(1, dt * c.slowmoRecover / Math.max(this.timeScale, 0.2));
        this.dieTimer -= dt * c.dieRate;
        if (this.dieTimer <= 0) {
            this.state = 'dead';
            this.emit({ type: 'died' });
        }
    }

    private crash() {
        if (this.state !== 'run') return;
        this.state = 'dying';
        this.turnWindow = null;
        this.dieTimer = this.cfg.death.dieDelay;
        this.timeScale = this.cfg.death.slowmo;
        this.emit({ type: 'crash' });
    }

    // ---------- 生成 ----------
    /** 动态生成间隔：随难度收紧，但不低于反应时间下限（支持单局教程覆写） */
    rowIntervalNow(): number {
        const d = this.cfg.difficulty;
        const baseInterval = this.runOverrides?.spawnRowInterval ?? this.cfg.spawn.rowInterval;
        const base = baseInterval * (1 - 0.55 * this.difficulty);
        return Math.max(base, d.minInterval, this.effectiveSpeed * d.reactionGuard);
    }

    /** 难度可用层级：D≥1/3 解锁 tier1，D≥2/3 解锁 tier2 */
    private maxTier(): number {
        return Math.min(2, Math.floor(this.difficulty * 3));
    }

    private weightedPick<T extends { weight: number }>(list: T[], rng: Rng): T {
        const total = list.reduce((acc, x) => acc + x.weight, 0);
        let r = rng.next() * total;
        for (const x of list) { r -= x.weight; if (r <= 0) return x; }
        return list[list.length - 1];
    }

    private randomDefId(): string {
        const c = this.catalog.spawn;
        const tier = this.maxTier();
        const pools = [c.randomPoolTier0, c.randomPoolTier1, c.randomPoolTier2];
        const merged: string[] = [];
        for (let t = 0; t <= Math.min(tier, pools.length - 1); t++) {
            const w = t === tier ? 3 : t === tier - 1 ? 2 : 1;
            for (let i = 0; i < w; i++) merged.push(...pools[t]);
        }
        if (!merged.length) merged.push(...pools[0]);
        const avail = merged.filter((id) => {
            const def = this.defMap.get(id);
            return !def?.unlockD || this.difficulty >= def.unlockD;
        });
        const pool = avail.length ? avail : merged;
        return pool[Math.floor(this.obstacleRng.next() * pool.length)];
    }

    /** 障碍事件占道并集（与碰撞/可达性同源） */
    private threatLanesFor(def: ObstacleDef, anchorLane: number): number[] {
        if (def.osc) return [...def.osc.lanes];
        if (def.rollSpeed) return [-1, 0, 1];
        return this.expandLanes(anchorLane, def.lanes);
    }

    /**
     * 生成一波挑战：模板（组合）或随机单体；全部经可达性验证并检查完整绝对坐标安全区。
     * @returns 是否实际生成了波（false = 安全区拦截）
     */
    private spawnWave(): boolean {
        const c = this.cfg;
        this.spawnDebug.calls++;
        const frontAbsD = this.toAbsD(c.world.spawnZ);
        if (!this.mapGen.path.isSafeSpawnRange(frontAbsD, frontAbsD, 6, 'obstacles')) {
            this.spawnDebug.zoneBlocks++;
            return false;
        }

        const lanesFree: number[] = [];
        for (let l = -this.laneMax; l <= this.laneMax; l++) lanesFree.push(l);
        const usedLanes = new Set<number>();

        // 保留仍在玩家前方且尚未进入当前已承诺动作窗的障碍参与跨波可达性验证
        const curSpd = Math.max(this.speed, this.effectiveSpeed);
        const pruneD = this.toAbsD(c.obstacle.hitZ);
        const upcoming = this.lastWaveEvents.filter((e) => {
            if (e.d <= pruneD) return false;
            const relZ = e.d - this.dist;
            if (this.jumpT >= 0 && e.pass === 'jump' && relZ < curSpd * (1 - this.jumpT) * this.jumpDurNow) return false;
            if (this.slideT >= 0 && e.pass === 'slide' && relZ < curSpd * this.slideT) return false;
            return true;
        });
        // 使用玩家抵达本波最远步进时的预期速度（含加速增长、冲刺倍率与 12% 判定余量），避免生成时可达、抵达时因增速/帧量化不可达
        const arrivalSpeed = c.speed.base + Math.min((frontAbsD + 20) * c.speed.gain, c.speed.gainCap);
        const evalSpeed = Math.max(arrivalSpeed, this.effectiveSpeed) * 1.12;
        const ability = abilityForSpeed(evalSpeed, {
            laneLerp: c.player.laneLerp,
            jumpDuration: c.player.jumpDuration,
            slideDuration: c.player.slideDuration,
            reactionTime: c.difficulty.reactionTime,
        });
        const actionReadyD = this.jumpT >= 0
            ? this.dist + (1 - this.jumpT) * this.jumpDurNow * curSpd
            : this.dist;
        const reachInit = {
            states: [{ lane: Math.round(this.targetLane), ready: this.dist, actionReady: actionReadyD }],
        };

        // ---- 模板路径 ----
        let spawned = false;
        if (this.obstacleRng.next() < this.catalog.spawn.patternChance) {
            const tier = this.maxTier();
            const pool = this.catalog.patterns.filter((p) => p.tier <= tier);
            for (let attempt = 0; attempt < 3 && !spawned; attempt++) {
                const pat = this.weightedPick(pool, this.obstacleRng);
                const anchor = lanesFree[Math.floor(this.obstacleRng.next() * lanesFree.length)];
                const steps = pat.steps.map((st) => ({
                    defId: st.def === 'random' ? this.randomDefId() : st.def,
                    lane: Math.max(-1, Math.min(1, anchor + st.lane)),
                    z: c.world.spawnZ + st.dz,
                }));
                // 统一使用绝对坐标检查整波区间 [minAbsD, maxAbsD] 是否全程在安全地块内
                const minAbsD = Math.min(...steps.map((st) => this.toAbsD(st.z)));
                const maxAbsD = Math.max(...steps.map((st) => this.toAbsD(st.z)));
                if (!this.mapGen.path.isSafeSpawnRange(minAbsD, maxAbsD, 6, 'obstacles')) {
                    this.spawnDebug.zoneBlocks++;
                    continue;
                }
                const newEvents: ObstacleEvent[] = steps.map((st) => {
                    const def = this.defMap.get(st.defId)!;
                    return {
                        d: this.toAbsD(st.z),
                        lanes: this.threatLanesFor(def, st.lane),
                        pass: (def.pass === 'timing' ? (def.rollSpeed ? 'jump' : 'lane') : def.pass) as 'jump' | 'slide' | 'lane',
                    };
                });
                const reach = validateReachability([...upcoming, ...newEvents], ability, reachInit);
                this.waveStats.validated++;
                if (reach.reachable) {
                    for (let k = 0; k < steps.length; k++) {
                        const st = steps[k];
                        this.obstacles.push({
                            defId: st.defId, lane: st.lane, z: st.z,
                            passed: false, phase: this.obstacleRng.next() * 10,
                        });
                        for (const ul of newEvents[k].lanes) usedLanes.add(ul);
                    }
                    this.lastWaveEvents = [...upcoming, ...newEvents];
                    spawned = true;
                    this.spawnDebug.patternSpawned++;
                } else {
                    this.waveStats.rejected++;
                }
            }
        }

        // ---- 兜底：随机单体（同样必须通过跨波可达性验证） ----
        if (!spawned) {
            const n = this.obstacleRng.next() < c.spawn.singleRowChance ? 1 : 2;
            const free = [...lanesFree];
            const picks: number[] = [];
            for (let i = 0; i < n && free.length; i++) {
                picks.push(free.splice(Math.floor(this.obstacleRng.next() * free.length), 1)[0]);
            }
            const eventsFor = (lanes: number[]) => {
                const defs = lanes.map(() => this.randomDefId());
                const evs = lanes.map((l, idx) => {
                    const def = this.defMap.get(defs[idx])!;
                    return {
                        d: frontAbsD,
                        lanes: this.threatLanesFor(def, l),
                        pass: (def.pass === 'timing' ? (def.rollSpeed ? 'jump' : 'lane') : def.pass) as 'jump' | 'slide' | 'lane',
                        defId: defs[idx],
                        lane: l,
                    };
                });
                return { evs };
            };
            for (const count of [picks.length, 1]) {
                const subset = picks.slice(0, count);
                if (subset.length === 0) break;
                const { evs } = eventsFor(subset);
                const newEvents = evs.map(({ d, lanes, pass }) => ({ d, lanes, pass }));
                const reach = validateReachability([...upcoming, ...newEvents], ability, reachInit);
                this.waveStats.validated++;
                if (reach.reachable) {
                    for (const e of evs) {
                        this.obstacles.push({
                            defId: e.defId, lane: e.lane, z: c.world.spawnZ,
                            passed: false, phase: this.obstacleRng.next() * 10,
                        });
                        for (const ul of e.lanes) usedLanes.add(ul);
                    }
                    this.lastWaveEvents = [...upcoming, ...newEvents];
                    spawned = true;
                    this.spawnDebug.fallbackSpawned++;
                    break;
                }
                this.waveStats.rejected++;
            }
            if (!spawned) this.spawnDebug.fullRejects++;
        }

        // ---- 阳炎碎片（独立 dropRng，空车道且整条碎片带落在安全地块内）----
        const fragStartAbsD = this.toAbsD(c.world.spawnZ + c.spawn.fragmentLead);
        const fragEndAbsD = this.toAbsD(c.world.spawnZ + c.spawn.fragmentLead + Math.max(0, c.spawn.fragmentCount - 1) * c.spawn.fragmentGap);
        if (this.dropRng.next() < c.spawn.fragmentChance
            && this.mapGen.path.isSafeSpawnRange(fragStartAbsD, fragEndAbsD, 2, 'obstacles')) {
            const fl = lanesFree.filter((l) => !usedLanes.has(l));
            if (fl.length) {
                const lane = fl[Math.floor(this.dropRng.next() * fl.length)];
                this.spawnDebug.fragRows++;
                this.spawnDebug.fragLanes.push(lane);
                for (let k = 0; k < c.spawn.fragmentCount; k++) {
                    this.fragments.push({
                        lane,
                        z: c.world.spawnZ + c.spawn.fragmentLead + k * c.spawn.fragmentGap,
                        got: false,
                    });
                }
            }
        }

        // ---- 道具（独立 dropRng，安全区校验 + 高温饮水保底）----
        const itemMul = this.themeNow.itemMul;
        const itemChance = this.catalog.spawn.itemChance * (1 + 0.6 * this.difficulty) * itemMul;
        const pityDue = this.heat >= c.heat.pityHeat && this.dist - this.lastWaterD > c.heat.pityDist;
        const itemZ = c.world.spawnZ + 2;
        const itemAbsD = this.toAbsD(itemZ);
        if ((this.dropRng.next() < itemChance || pityDue)
            && this.mapGen.path.isSafeSpawnRange(itemAbsD, itemAbsD, 2, 'obstacles')) {
            const fl = lanesFree.filter((l) => !usedLanes.has(l));
            if (fl.length) {
                const kind: ItemKind = pityDue ? 'water' : this.weightedPick(this.catalog.items, this.dropRng).id as ItemKind;
                this.items.push({ kind, lane: fl[Math.floor(this.dropRng.next() * fl.length)], z: itemZ, got: false });
                this.spawnDebug.itemCount++;
                if (pityDue) this.spawnDebug.pityFires++;
                if (kind === 'water') this.lastWaterD = this.dist;
            }
        }
        return true;
    }

    /** 拾取道具（效果/叠加/优先级规则） */
    private pickItem(kind: ItemKind) {
        const def = this.catalog.items.find((x) => x.id === kind);
        const dur = def?.duration ?? 0;
        switch (kind) {
        case 'magnet': this.magnetT = Math.max(this.magnetT, dur + this.mods.magnetBonus); break;
        case 'double': this.doubleT = Math.max(this.doubleT, dur); break;
        case 'dash': this.dashT = Math.max(this.dashT, dur); break;
        case 'shield': this.shieldCharges = Math.max(this.shieldCharges, 1); break;
        case 'water':
            this.stumbleTimer = 0;
            this.slowTimer = 0; this.slowFactor = 1;
            this.heat = Math.max(0, this.heat - (this.cfg.heat.waterReduce + this.mods.waterReduceBonus));
            this.lastWaterD = this.dist;
            this.emit({ type: 'water' });
            break;
        case 'staff':
            this.staffCharges = Math.min(this.staffCharges + 3, 6 + this.mods.staffCapBonus);
            break;
        case 'leap':
            this.leapT = Math.max(this.leapT, dur);
            break;
        }
    }

    /** 侧景装饰生成（独立 decorRng，不干扰障碍/掉落随机流） */
    private spawnProp() {
        const c = this.cfg.spawn;
        const absD = this.toAbsD(this.cfg.world.spawnZ);
        if (!this.mapGen.path.isSafeSpawnRange(absD, absD, 6, 'props')) return;
        const side = this.decorRng.next() < 0.5 ? -1 : 1;
        this.props.push({
            x: side * (c.propSideMin + this.decorRng.next() * c.propSideSpread),
            z: this.cfg.world.spawnZ,
            kind: this.decorRng.next() < c.treeChance ? 'tree' : 'rock',
            s: c.propScaleMin + this.decorRng.next() * c.propScaleSpread,
            sway: this.decorRng.next() * 6.28,
        });
    }
}
