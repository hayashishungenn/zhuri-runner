/**
 * GameCore —— 核心玩法状态机与全部规则（唯一规则真源）。
 * 纯 TypeScript，零 cc 依赖：可在 Node 单测，也可对接任意渲染器。
 *
 * 数值全部来自 GameConfig（P0 原型实测值），机制与 P0 逐行为等价移植。
 * 坐标约定：车道 lane ∈ {-1,0,1}（laneCount 可扩），z 轴向玩家递减：spawnZ 出现、0 为玩家、despawnZ 移除。
 */
import { GameConfig } from '../config/GameConfigSchema';
import { ObstacleCatalog, ObstacleDef, defaultCatalog } from '../config/ObstacleCatalog';
import { validateReachability, abilityForSpeed } from './Reachability';
import { SystemRng, Rng } from './rng';
import { Obstacle, ItemKind, ItemEntity, Fragment, Prop, GameState, CoreEvent } from './types';
import { ThemeCfg } from '../config/GameConfigSchema';
import { MapGenerator, Corner } from './MapGenerator';

export class GameCore {
    readonly cfg: GameConfig;

    // ---- 运行时状态（渲染器只读） ----
    state: GameState = 'title';
    gTime = 0;              // 全局时钟（贯穿标题/死亡，驱动天色与虚线动画）
    timeScale = 1;          // 慢动作系数
    dist = 0;               // 逻辑距离（里 = dist * liScale）
    frags = 0;              // 阳炎计数
    speed: number;          // 速度公式值（不含踉跄减速）
    runPhase = 0;           // 跑步动画相位
    playerLaneF = 0;        // 当前车道（浮点，缓动中）
    targetLane = 0;
    jumpT = -1;             // [-1]未跳；[0,1)跳跃进度
    slideT = -1;            // [-1]未俯冲；[0,slideDuration]剩余时间
    invincible = 0;         // 无敌剩余时间（复活/踉跄豁免共用）
    reviveUsed = false;
    milestone: number;
    dieTimer = -1;
    paused = false;         // 暂停（仅 run 状态可暂停；冻结整帧推进）
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
    staffCharges = 0;       // 桃木神杖层数（破坏切道/时机类障碍，0-6）
    leapT = 0;              // 巨人之跃剩余（跳跃更久更高）
    // ---- Phase 4 高温与逐日 ----
    heat = 0;               // 热量 [0,100]（100 不死：强制减速 maxSlow）
    lastWaterD = 0;         // 上次饮水资源出现/拾取的里程（保底用）
    // ---- Phase 4 游戏模式与征途 ----
    mode: 'endless' | 'journey' = 'endless';
    journeyStage = 0;       // 已完成的征途阶段数
    /** 当前难度 [0,1]（里程驱动，封顶） */
    get difficulty(): number { return Math.min(this.li / this.cfg.difficulty.rampLi, 1); }

    private spawnAcc: number;
    private propAcc = 0;
    private rng: Rng;
    private events: CoreEvent[] = [];
    private slowFactor = 1;     // 减速倍率（踉跄等触发）
    private slowTimer = 0;
    private lastWaveEvents: { d: number; lanes: number[]; pass: 'jump' | 'slide' | 'lane' }[] = [];
    /** 可达性验证统计（管线证据：validated 含与上一波合并的联合验证） */
    readonly waveStats = { validated: 0, rejected: 0 };
    readonly spawnDebug = { calls: 0, zoneBlocks: 0, patternSpawned: 0, fallbackSpawned: 0, fullRejects: 0, fragRows: 0, fragLanes: [] as number[], itemCount: 0, pityFires: 0 };

    // ---- Phase 2：无限地图与转弯 ----
    readonly mapGen: MapGenerator;
    /** 世界空间路径（渲染层采样用；玩家 dist 即其在路径上的位置） */
    get path() { return this.mapGen.path; }
    /** 转弯操作窗口（null = 无窗口）；d 为路口判定点绝对距离 */
    turnWindow: { dir: 1 | -1; d: number } | null = null;
    cornersPassed = 0;

    readonly catalog: ObstacleCatalog;
    private defMap = new Map<string, ObstacleDef>();

    constructor(cfg: GameConfig, rng?: Rng, opts?: { turnsEnabled?: boolean; catalog?: ObstacleCatalog; mode?: 'endless' | 'journey' }) {
        this.cfg = cfg;
        if (opts?.mode) this.mode = opts.mode;
        this.rng = rng ?? new SystemRng();
        this.speed = cfg.speed.base;
        this.milestone = cfg.milestone.step;
        this.spawnAcc = cfg.spawn.rowInterval * 0.5;   // P0 初值 4 = 半个生成间隔
        this.catalog = opts?.catalog ?? defaultCatalog();
        for (const d of this.catalog.obstacles) this.defMap.set(d.id, d);
        // 地图生成：默认关闭转弯（旧测试语义不变）；3D 渲染模式由 Game 开启
        this.mapGen = new MapGenerator({
            ...cfg.map,
            turnsEnabled: opts?.turnsEnabled ?? false,
        });
        this.mapGen.update(0);
    }

    private defOf(o: Obstacle): ObstacleDef {
        const d = this.defMap.get(o.defId);
        if (!d) throw new Error(`未知障碍 defId: ${o.defId}`);
        return d;
    }

    /** 障碍当前占道（timing 障碍按相位计算，并回写 lane/visLane 供渲染/测试驱动） */
    obstacleLanes(o: Obstacle): number[] {
        const def = this.defOf(o);
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        if (def.osc) {
            const half = def.osc.period / 2;
            const idx = Math.floor((this.gTime + o.phase) / half) % 2;
            o.lane = def.osc.lanes[idx];
            return this.expandLanes(o.lane, def.lanes);
        }
        if (def.rollSpeed) {
            const pos = ((this.gTime * def.rollSpeed + o.phase) % 2.4) - 1.2;
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
        return out.sort();
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

    // ---------- 流程 ----------
    startRun() {
        this.reset();
        this.state = 'run';
    }

    /** 暂停（仅 run 状态；冻结整帧推进，gTime 一并冻结） */
    pause() {
        if (this.state === 'run') this.paused = true;
    }

    resume() {
        this.paused = false;
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
     * 方向正确 → 通过路口；方向错误 → 立即撞墙死亡。
     * @returns 是否成功转向
     */
    tryTurn(dir: 1 | -1): boolean {
        if (this.state !== 'run' || this.paused || !this.turnWindow) return false;
        const c = this.findCorner(this.turnWindow.d);
        if (dir === this.turnWindow.dir) {
            if (c) c.passed = true;
            this.cornersPassed++;
            this.events.push({ type: 'turnOk' });
            this.turnWindow = null;
            return true;
        }
        // 转错方向：冲出跑道
        this.events.push({ type: 'turnMiss' });
        this.crash();
        return false;
    }

    private findCorner(d: number): Corner | undefined {
        return this.mapGen.corners.find((c) => Math.abs(c.d - d) < 0.5);
    }

    /** 死亡结算后的复活（广告发奖回调触发） */
    revive() {
        this.reviveUsed = true;
        // 清除近处障碍（z <= reviveKeepZ），保留远景
        this.obstacles = this.obstacles.filter((o) => o.z > this.cfg.player.reviveKeepZ);
        this.invincible = this.cfg.player.reviveInvincible;
        this.stumbleTimer = 0;
        this.slowTimer = 0; this.slowFactor = 1;
        this.state = 'run';
        this.timeScale = 1;
    }

    private reset() {
        const c = this.cfg;
        this.playerLaneF = 0; this.targetLane = 0;
        this.jumpT = -1; this.slideT = -1; this.runPhase = 0;
        this.dist = 0; this.frags = 0; this.speed = c.speed.base;
        this.obstacles = []; this.fragments = []; this.props = [];
        this.spawnAcc = c.spawn.rowInterval * 0.5; this.propAcc = 0;
        this.dieTimer = -1;
        this.reviveUsed = false; this.invincible = 0;
        this.milestone = c.milestone.step; this.timeScale = 1;
        this.paused = false;
        this.stumbleTimer = 0;
        this.slowFactor = 1; this.slowTimer = 0;
        this.items = [];
        this.magnetT = 0; this.dashT = 0; this.doubleT = 0; this.shieldCharges = 0;
        this.staffCharges = 0; this.leapT = 0;
        this.heat = 0; this.lastWaterD = 0;
        this.journeyStage = 0;
        this.lastWaveEvents = [];
        // 无限地图：同种子重建（可复现）
        this.mapGen.reset();
        this.mapGen.update(0);
        this.turnWindow = null;
        this.cornersPassed = 0;
    }

    // ---------- 输入意图 ----------
    // 动作优先级（Phase 1 规则化，详见 GAME_DESIGN）：
    //   dying/dead/paused/title：不受理任何玩法输入
    //   run：变道 ✓ 跳 ✓（仅地面、无二段跳）滑铲 ✓
    //   空中：变道 ✓ 滑铲 ✓（俯冲斩断跳跃）跳 ✗
    //   滑铲中：变道 ✓ 跳 ✓（起跳取消滑铲）滑铲 ✓（重置时长）
    //   踉跄：作为 run 的修正器存在，全部输入照常受理（受豁免无敌保护）
    doLane(dir: number) {
        if (this.state !== 'run' || this.paused) return;
        this.targetLane = Math.max(-this.laneMax, Math.min(this.laneMax, this.targetLane + dir));
    }
    doJump() {
        if (this.state !== 'run' || this.paused) return;
        if (this.jumpT < 0) {
            this.jumpT = 0;
            this.slideT = -1;          // 起跳取消滑铲
            this.events.push({ type: 'jump' });
        }
    }
    doSlide() {
        if (this.state !== 'run' || this.paused) return;
        // 空中俯冲：斩断跳跃，快速落地
        if (this.jumpT >= 0) this.jumpT = this.cfg.player.diveJumpTo;
        const wasSliding = this.slideT >= 0;
        this.slideT = this.cfg.player.slideDuration;
        if (!wasSliding) this.events.push({ type: 'slideStart' });
    }

    // ---------- 主循环 ----------
    update(dtRaw: number) {
        if (this.paused) return;               // 暂停：整帧冻结（含 gTime）
        const dt = Math.min(dtRaw, 0.033);
        this.gTime += dt;
        if (this.state === 'run') {
            this.updateRun(dt * this.timeScale);
            // updateRun 内可能 crash() → 'dying'，此时恢复由 updateDying 分支负责
            if ((this.state as GameState) !== 'dying') this.recoverTimeScale(dt, this.cfg.death.ambientRecover);
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
        // 踉跄/减速/道具计时（浮点残差防护：< 1e-9 归零，避免永久生效）
        if (this.stumbleTimer > 0) { this.stumbleTimer = Math.max(0, this.stumbleTimer - dt); if (this.stumbleTimer < 1e-9) this.stumbleTimer = 0; }
        if (this.slowTimer > 0) {
            this.slowTimer = Math.max(0, this.slowTimer - dt);
            if (this.slowTimer < 1e-9) { this.slowTimer = 0; this.slowFactor = 1; }
        }
        if (this.magnetT > 0) { this.magnetT = Math.max(0, this.magnetT - dt); if (this.magnetT < 1e-9) this.magnetT = 0; }
        if (this.doubleT > 0) { this.doubleT = Math.max(0, this.doubleT - dt); if (this.doubleT < 1e-9) this.doubleT = 0; }
        if (this.leapT > 0) { this.leapT = Math.max(0, this.leapT - dt); if (this.leapT < 1e-9) this.leapT = 0; }
        if (this.dashT > 0) {
            this.dashT = Math.max(0, this.dashT - dt);
            if (this.dashT < 1e-9) this.dashT = 0;
            this.invincible = Math.max(this.invincible, this.dashT);   // 冲刺期间无敌
        }
        this.dist += spd * dt;
        // 高温：随难度与主题升温，封顶 100（永不致死——热满仅强制减速 maxSlow）
        if (this.heat < 100) {
            const themeMul = this.themeNow.heatMul;
            this.heat = Math.min(100, this.heat + c.heat.baseRate * themeMul * (1 + c.heat.dScale * this.difficulty) * dt);
        }
        if (this.li >= this.milestone) {
            this.events.push({ type: 'milestone', n: this.milestone });
            this.milestone += c.milestone.step;
        }
        // 征途阶段与通关（仅征途模式）
        if (this.mode === 'journey') {
            const stages = c.journey.stages;
            if (this.journeyStage < stages.length) {
                const st = stages[this.journeyStage];
                if (this.li >= st.goalLi) {
                    this.journeyStage++;
                    this.events.push({ type: 'stage', n: this.journeyStage, label: st.label });
                    if (this.journeyStage >= stages.length) {
                        this.state = 'ended';                       // 通关：逐日功成
                        this.events.push({ type: 'journeyDone' });
                        return;
                    }
                }
            }
        }
        if (this.invincible > 0) this.invincible -= dt;
        this.playerLaneF += (this.targetLane - this.playerLaneF) * Math.min(1, dt * c.player.laneLerp);
        if (this.jumpT >= 0) {
            this.jumpT += dt / this.jumpDurNow;
            if (this.jumpT >= 1) { this.jumpT = -1; this.events.push({ type: 'land' }); }
        }
        if (this.slideT >= 0) { this.slideT -= dt; if (this.slideT < 0) this.slideT = -1; }
        this.runPhase += dt * (6 + spd * 0.35);

        // 生成（动态密度：随难度收紧，但不低于反应时间下限）
        // 安全区拦截时丢弃该波（特殊区/弯道附近自然稀疏，玩家无感）
        this.spawnAcc += spd * dt;
        if (this.spawnAcc > this.rowIntervalNow()) { this.spawnAcc = 0; this.spawnWave(); }
        this.propAcc += spd * dt;
        if (this.propAcc > c.spawn.propInterval) { this.propAcc = 0; this.spawnProp(); }
        // 地图生成难度联动（转弯频率随难度提升）
        this.mapGen.difficulty = this.difficulty;

        // 障碍推进 + 判定（catalog 数据驱动）
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            o.z -= spd * dt;
            if (o.z < c.world.despawnZ) { this.obstacles.splice(i, 1); continue; }
            // timing 障碍：逐帧更新占道（摆动切换/滚石横移），保证渲染与判定同源
            if (this.defOf(o).pass === 'timing') this.obstacleLanes(o);
            if (!o.passed && o.z < c.obstacle.hitZ) {
                o.passed = true;
                const def = this.defOf(o);
                const lanes = this.obstacleLanes(o);
                const myLane = Math.round(this.playerLaneF);
                const jumping = this.jumpT >= 0 && this.jumpT > c.player.jumpSafeFrom && this.jumpT < c.player.jumpSafeTo;
                const sliding = this.slideT >= 0;
                // 通行条件：timing 障碍中滚石按跳跃（时机跳跃）、摆动类按切道
                const effPass = def.pass === 'timing' ? (def.rollSpeed ? 'jump' : 'lane') : def.pass;
                let safe = false;
                if (!lanes.includes(myLane)) safe = true;
                else if (effPass === 'jump') safe = jumping;
                else if (effPass === 'slide') safe = sliding;
                // 桃木神杖：撞上切道/时机类障碍时消耗 1 层将其击碎（跳跃/滑铲类不适用——那些本可动作通过）
                if (!safe && this.staffCharges > 0 && (def.pass === 'lane' || def.pass === 'timing')) {
                    this.staffCharges--;
                    this.invincible = Math.max(this.invincible, 0.8);
                    o.z = -3;
                    this.events.push({ type: 'staffBreak' });
                    continue;
                }
                if (!safe && this.invincible <= 0 && this.shieldCharges > 0) {
                    // 护盾：抵挡一次任何撞击（含墙），击碎障碍 + 短无敌
                    this.shieldCharges--;
                    this.invincible = Math.max(this.invincible, 1.2);
                    o.z = -3;
                    this.events.push({ type: 'shieldBreak' });
                    continue;
                }
                if (!safe && this.invincible <= 0) {
                    // 受击分级：踉跄类首撞 → 踉跄；踉跄中再撞或即死类 → 死亡
                    const canStumble = c.player.stumble.enabled && def.damage === 'stumble' && !this.stumbling;
                    if (canStumble) {
                        this.stumbleTimer = c.player.stumble.duration;
                        this.invincible = c.player.stumble.mercyInvincible;
                        this.applySlowdown(c.player.stumble.speedFactor, c.player.stumble.duration);
                        o.z = -3;              // 击碎该障碍
                        this.events.push({ type: 'stumble' });
                    } else {
                        this.crash();
                        return;
                    }
                }
                if (!safe && this.invincible > 0 && o.z !== -3) { o.z = -3; this.events.push({ type: 'obstacleSmashed' }); }
                else if (safe && lanes.includes(myLane)) {
                    this.events.push({ type: 'obstaclePassed' });
                    // 清凉水花：安全越过溪流降温（策略性：溪流由威胁变为资源）
                    if (def.vis === 'water') {
                        this.heat = Math.max(0, this.heat - c.heat.streamReduce);
                        this.events.push({ type: 'cool', amount: c.heat.streamReduce });
                    }
                }
            }
        }
        // 道具拾取
        for (let i = this.items.length - 1; i >= 0; i--) {
            const it = this.items[i];
            it.z -= spd * dt;
            if (it.z < c.world.despawnZ) { this.items.splice(i, 1); continue; }
            if (!it.got && it.z < c.obstacle.pickupZTo && it.z > c.obstacle.pickupZFrom
                && Math.round(this.playerLaneF) === it.lane) {
                it.got = true;
                this.pickItem(it.kind);
                this.events.push({ type: 'item', kind: it.kind });
                this.items.splice(i, 1);
            }
        }
        // 磁吸：近处碎片吸附到玩家车道
        if (this.magnetT > 0) {
            for (const f of this.fragments) {
                if (!f.got && f.z > 0 && f.z < 8) f.lane = Math.round(this.playerLaneF);
            }
        }
        // 阳炎拾取
        for (let i = this.fragments.length - 1; i >= 0; i--) {
            const f = this.fragments[i];
            f.z -= spd * dt;
            if (f.z < c.world.despawnZ) { this.fragments.splice(i, 1); continue; }
            if (!f.got && f.z < c.obstacle.pickupZTo && f.z > c.obstacle.pickupZFrom
                && Math.round(this.playerLaneF) === f.lane) {
                f.got = true;
                this.frags += this.doubleT > 0 ? 2 : 1;
                this.events.push({ type: 'fragment', lane: f.lane });
            }
        }
        for (let i = this.props.length - 1; i >= 0; i--) {
            this.props[i].z -= spd * dt;
            if (this.props[i].z < c.world.despawnZ) this.props.splice(i, 1);
        }
    }

    /** 转弯窗口状态机：进入窗口开启；越过路口未转向 → 撞墙（转弯失败） */
    private updateTurnWindow() {
        const next = this.mapGen.corners.find((c) => !c.passed);
        const W = this.cfg.map.turnWindow;
        if (this.turnWindow) {
            const passed = this.findCorner(this.turnWindow.d)?.passed;
            if (passed) { this.turnWindow = null; return; }
            if (this.dist > this.turnWindow.d + 0.6) {
                // 错过转弯：撞上路口墙体（无敌不豁免——墙是跑道本体）
                this.events.push({ type: 'turnMiss' });
                this.turnWindow = null;
                this.crash();
            }
            return;
        }
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
            this.events.push({ type: 'died' });
        }
    }

    private crash() {
        this.state = 'dying';
        this.dieTimer = this.cfg.death.dieDelay;
        this.timeScale = this.cfg.death.slowmo;
        this.events.push({ type: 'crash' });
    }

    // ---------- 生成 ----------
    /** 动态生成间隔：随难度收紧，但不低于反应时间下限（速度×reactionGuard 与绝对下限取大） */
    rowIntervalNow(): number {
        const d = this.cfg.difficulty;
        const base = this.cfg.spawn.rowInterval * (1 - 0.55 * this.difficulty);
        return Math.max(base, d.minInterval, this.effectiveSpeed * d.reactionGuard);
    }

    /** 难度可用层级：D≥1/3 解锁 tier1，D≥2/3 解锁 tier2 */
    private maxTier(): number {
        return Math.min(2, Math.floor(this.difficulty * 3));
    }

    private weightedPick<T extends { weight: number }>(list: T[]): T {
        const total = list.reduce((acc, x) => acc + x.weight, 0);
        let r = this.rng.next() * total;
        for (const x of list) { r -= x.weight; if (r <= 0) return x; }
        return list[list.length - 1];
    }

    private randomDefId(): string {
        const c = this.catalog.spawn;
        const tier = this.maxTier();
        const pools = [c.randomPoolTier0, c.randomPoolTier1, c.randomPoolTier2];
        // 从当前及以下层级合并抽样（高 tiers 权重随难度增大）
        const merged: string[] = [];
        for (let t = 0; t <= Math.min(tier, pools.length - 1); t++) {
            const w = t === tier ? 3 : t === tier - 1 ? 2 : 1;
            for (let i = 0; i < w; i++) merged.push(...pools[t]);
        }
        if (!merged.length) merged.push(...pools[0]);
        // 过滤 unlockD
        const avail = merged.filter((id) => {
            const def = this.defMap.get(id);
            return !def?.unlockD || this.difficulty >= def.unlockD;
        });
        const pool = avail.length ? avail : merged;
        return pool[Math.floor(this.rng.next() * pool.length)];
    }

    /**
     * 生成一波挑战：模板（组合）或随机单体；模板先经可达性验证（失败重掷，兜底单体）。
     * 生成避让：整波 + 碎片带需落在允许生成的直线段。
     */
    /** @returns 是否实际生成了波（false = 安全区拦截，调用方丢弃该波） */
    private spawnWave(): boolean {
        const c = this.cfg;
        this.spawnDebug.calls++;
        const front = this.dist + c.world.spawnZ;
        const back = front + c.spawn.fragmentLead + c.spawn.fragmentCount * c.spawn.fragmentGap;
        if (!this.mapGen.path.isSafeSpawnZone(front, 4) || !this.mapGen.path.isSafeSpawnZone(back, 2)) { this.spawnDebug.zoneBlocks++; return false; }

        const lanesFree: number[] = [];
        for (let l = -this.laneMax; l <= this.laneMax; l++) lanesFree.push(l);
        const usedLanes: number[] = [];
        const placed: { defId: string; lane: number; z: number }[] = [];

        // ---- 模板路径（可达性验证：与上一波合并验证跨波组合）----
        let spawned = false;
        if (this.rng.next() < this.catalog.spawn.patternChance) {
            const tier = this.maxTier();
            const pool = this.catalog.patterns.filter((p) => p.tier <= tier);
            const ability = abilityForSpeed(this.speed, {
                laneLerp: c.player.laneLerp,
                jumpDuration: c.player.jumpDuration,
                slideDuration: c.player.slideDuration,
                reactionTime: c.difficulty.reactionTime,
            });
            for (let attempt = 0; attempt < 3 && !spawned; attempt++) {
                const pat = this.weightedPick(pool);
                const anchor = lanesFree[Math.floor(this.rng.next() * lanesFree.length)];
                const steps = pat.steps.map((st) => ({
                    defId: st.def === 'random' ? this.randomDefId() : st.def,
                    lane: Math.max(-1, Math.min(1, anchor + st.lane)),
                    z: c.world.spawnZ + st.dz,
                }));
                // 波跨度安全区：最远步进也必须落在允许生成的直线段（模板可能跨 18+ 单位）
                const maxDz = Math.max(...steps.map((st) => st.z));
                if (!this.mapGen.path.isSafeSpawnZone(maxDz, 4)) {
                    this.spawnDebug.zoneBlocks++;
                    continue;
                }
                const newEvents = steps.map((st) => {
                    const def = this.defMap.get(st.defId)!;
                    // timing 障碍按"扫过车道并集"登记（摆动/滚石的实际威胁范围，保守最坏情形）
                    let lanes: number[];
                    if (def.osc) lanes = def.osc.lanes;
                    else if (def.rollSpeed) lanes = [-1, 0, 1];
                    else lanes = this.expandLanes(st.lane, def.lanes);
                    return {
                        d: this.dist + st.z,
                        lanes,
                        pass: (def.pass === 'timing' ? (def.rollSpeed ? 'jump' : 'lane') : def.pass) as 'jump' | 'slide' | 'lane',
                    };
                });
                // 跨波合并验证：上一波尚在前方的障碍 + 本波
                const reach = validateReachability([...this.lastWaveEvents, ...newEvents], ability);
                this.waveStats.validated++;
                if (reach.reachable) {
                    for (const st of steps) {
                        this.obstacles.push({ defId: st.defId, lane: st.lane, z: st.z, passed: false, phase: this.rng.next() * 10 });
                        usedLanes.push(st.lane);
                    }
                    placed.push(...steps);
                    this.lastWaveEvents = [...this.lastWaveEvents, ...newEvents]
                        .filter((e) => e.d > this.dist + c.world.spawnZ * 0.5);   // 剪除已判定区间
                    spawned = true;
                    this.spawnDebug.patternSpawned++;
                } else {
                    this.waveStats.rejected++;
                }
                void spawned;
            }
        }
        // ---- 兜底：随机单体（模板被拒/未选中）——同样必须通过合并可达性验证 ----
        if (!spawned) {
            const n = this.rng.next() < c.spawn.singleRowChance ? 1 : 2;
            const free = [...lanesFree];
            const picks: number[] = [];
            for (let i = 0; i < n && free.length; i++) {
                picks.push(free.splice(Math.floor(this.rng.next() * free.length), 1)[0]);
            }
            const ability = abilityForSpeed(this.speed, {
                laneLerp: c.player.laneLerp,
                jumpDuration: c.player.jumpDuration,
                slideDuration: c.player.slideDuration,
                reactionTime: c.difficulty.reactionTime,
            });
            const eventsFor = (lanes: number[]) => {
                const defs = lanes.map(() => this.randomDefId());
                const evs = lanes.map((l, _i) => {
                    const def = this.defMap.get(defs[_i])!;
                    let ln: number[];
                    if (def.osc) ln = def.osc.lanes;
                    else if (def.rollSpeed) ln = [-1, 0, 1];
                    else ln = this.expandLanes(l, def.lanes);
                    return {
                        d: this.dist + c.world.spawnZ,
                        lanes: ln,
                        pass: (def.pass === 'timing' ? (def.rollSpeed ? 'jump' : 'lane') : def.pass) as 'jump' | 'slide' | 'lane',
                        defId: defs[_i],
                        lane: l,
                    };
                });
                return { evs };
            };
            // 依次尝试 2 连、1 个；每次与上一波合并验证
            for (const count of [picks.length, 1]) {
                const subset = picks.slice(0, count);
                if (subset.length === 0) break;
                const { evs } = eventsFor(subset);
                const reach = validateReachability([...this.lastWaveEvents, ...evs.map(({ d, lanes, pass }) => ({ d, lanes, pass }))], ability);
                this.waveStats.validated++;
                if (reach.reachable) {
                    evs.forEach((e) => {
                        this.obstacles.push({ defId: e.defId, lane: e.lane, z: c.world.spawnZ, passed: false, phase: this.rng.next() * 10 });
                        usedLanes.push(e.lane);
                        placed.push({ defId: e.defId, lane: e.lane, z: c.world.spawnZ });
                    });
                    this.lastWaveEvents = [...this.lastWaveEvents, ...evs.map(({ d, lanes, pass }) => ({ d, lanes, pass }))]
                        .filter((e) => e.d > this.dist + c.world.spawnZ * 0.5);
                    spawned = true;
                    this.spawnDebug.fallbackSpawned++;
                    break;
                }
                this.waveStats.rejected++;
            }
            if (!spawned) this.spawnDebug.fullRejects++;
        }

        // ---- 阳炎碎片（空车道）----
        if (this.rng.next() < c.spawn.fragmentChance) {
            const fl = lanesFree.filter((l) => !usedLanes.includes(l));
            if (fl.length) {
                const lane = fl[Math.floor(this.rng.next() * fl.length)];
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
        // ---- 道具（难度越高概率越大；主题 itemMul 联动；高温饮水保底）----
        const itemMul = this.themeNow.itemMul;
        const itemChance = this.catalog.spawn.itemChance * (1 + 0.6 * this.difficulty) * itemMul;
        const pityDue = this.heat >= c.heat.pityHeat && this.dist - this.lastWaterD > c.heat.pityDist;
        if (this.rng.next() < itemChance || pityDue) {
            const fl = lanesFree.filter((l) => !usedLanes.includes(l));
            if (fl.length) {
                // 保底：高温且久无饮水 → 强制甘霖（资源保底，杜绝随机缺水必然失败）
                const kind: ItemKind = pityDue ? 'water' : this.weightedPick(this.catalog.items).id as ItemKind;
                this.items.push({ kind, lane: fl[Math.floor(this.rng.next() * fl.length)], z: c.world.spawnZ + 2, got: false });
                this.spawnDebug.itemCount++;
                if (pityDue) this.spawnDebug.pityFires++;
                if (kind === 'water') this.lastWaterD = this.dist;
            }
        }
        void placed;
        return true;
    }

    /** 拾取道具（效果/叠加/优先级规则） */
    private pickItem(kind: ItemKind) {
        const def = this.catalog.items.find((x) => x.id === kind);
        const dur = def?.duration ?? 0;
        switch (kind) {
        case 'magnet': this.magnetT = Math.max(this.magnetT, dur); break;   // 同类延长
        case 'double': this.doubleT = Math.max(this.doubleT, dur); break;
        case 'dash': this.dashT = Math.max(this.dashT, dur); break;          // 替换剩余
        case 'shield': this.shieldCharges = Math.max(this.shieldCharges, 1); break;  // 不叠加
        case 'water':
            this.stumbleTimer = 0;                                            // 甘霖：解除踉跄/减速
            this.slowTimer = 0; this.slowFactor = 1;
            this.heat = Math.max(0, this.heat - this.cfg.heat.waterReduce);   // 降温
            this.lastWaterD = this.dist;                                      // 保底窗口重置
            this.events.push({ type: 'water' });
            break;
        case 'staff':
            this.staffCharges = Math.min(this.staffCharges + 3, 6);           // 桃木神杖：+3 层，上限 6
            break;
        case 'leap':
            this.leapT = Math.max(this.leapT, dur);                           // 巨人之跃：同类延长
            break;
        }
    }

    private spawnProp() {
        const c = this.cfg.spawn;
        if (!this.mapGen.path.isSafeSpawnZone(this.dist + this.cfg.world.spawnZ, 6)) return;
        const side = this.rng.next() < 0.5 ? -1 : 1;
        this.props.push({
            x: side * (c.propSideMin + this.rng.next() * c.propSideSpread),
            z: this.cfg.world.spawnZ,
            kind: this.rng.next() < c.treeChance ? 'tree' : 'rock',
            s: c.propScaleMin + this.rng.next() * c.propScaleSpread,
            sway: this.rng.next() * 6.28,
        });
    }
}
