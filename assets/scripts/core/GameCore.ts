/**
 * GameCore —— 核心玩法状态机与全部规则（唯一规则真源）。
 * 纯 TypeScript，零 cc 依赖：可在 Node 单测，也可对接任意渲染器。
 *
 * 数值全部来自 GameConfig（P0 原型实测值），机制与 P0 逐行为等价移植。
 * 坐标约定：车道 lane ∈ {-1,0,1}（laneCount 可扩），z 轴向玩家递减：spawnZ 出现、0 为玩家、despawnZ 移除。
 */
import { GameConfig } from '../config/GameConfigSchema';
import { SystemRng, Rng } from './rng';
import { Obstacle, ObstacleType, Fragment, Prop, GameState, CoreEvent } from './types';
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

    private spawnAcc: number;
    private propAcc = 0;
    private rng: Rng;
    private events: CoreEvent[] = [];
    private slowFactor = 1;     // 减速倍率（踉跄等触发）
    private slowTimer = 0;

    // ---- Phase 2：无限地图与转弯 ----
    readonly mapGen: MapGenerator;
    /** 世界空间路径（渲染层采样用；玩家 dist 即其在路径上的位置） */
    get path() { return this.mapGen.path; }
    /** 转弯操作窗口（null = 无窗口）；d 为路口判定点绝对距离 */
    turnWindow: { dir: 1 | -1; d: number } | null = null;
    cornersPassed = 0;

    constructor(cfg: GameConfig, rng?: Rng, opts?: { turnsEnabled?: boolean }) {
        this.cfg = cfg;
        this.rng = rng ?? new SystemRng();
        this.speed = cfg.speed.base;
        this.milestone = cfg.milestone.step;
        this.spawnAcc = cfg.spawn.rowInterval * 0.5;   // P0 初值 4 = 半个生成间隔
        // 地图生成：默认关闭转弯（旧测试语义不变）；3D 渲染模式由 Game 开启
        this.mapGen = new MapGenerator({
            ...cfg.map,
            turnsEnabled: opts?.turnsEnabled ?? false,
        });
        this.mapGen.update(0);
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
    /** 实际推进速度 = 速度公式 × 减速倍率 */
    get effectiveSpeed(): number { return this.speed * (this.slowTimer > 0 ? this.slowFactor : 1); }

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
        // 踉跄/减速计时
        if (this.stumbleTimer > 0) this.stumbleTimer = Math.max(0, this.stumbleTimer - dt);
        if (this.slowTimer > 0) {
            this.slowTimer = Math.max(0, this.slowTimer - dt);
            if (this.slowTimer === 0) this.slowFactor = 1;
        }
        this.dist += spd * dt;
        if (this.li >= this.milestone) {
            this.events.push({ type: 'milestone', n: this.milestone });
            this.milestone += c.milestone.step;
        }
        if (this.invincible > 0) this.invincible -= dt;
        this.playerLaneF += (this.targetLane - this.playerLaneF) * Math.min(1, dt * c.player.laneLerp);
        if (this.jumpT >= 0) {
            this.jumpT += dt / c.player.jumpDuration;
            if (this.jumpT >= 1) { this.jumpT = -1; this.events.push({ type: 'land' }); }
        }
        if (this.slideT >= 0) { this.slideT -= dt; if (this.slideT < 0) this.slideT = -1; }
        this.runPhase += dt * (6 + spd * 0.35);

        // 生成
        this.spawnAcc += spd * dt;
        if (this.spawnAcc > c.spawn.rowInterval) { this.spawnAcc = 0; this.spawnRow(); }
        this.propAcc += spd * dt;
        if (this.propAcc > c.spawn.propInterval) { this.propAcc = 0; this.spawnProp(); }

        // 障碍推进 + 判定
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            o.z -= spd * dt;
            if (o.z < c.world.despawnZ) { this.obstacles.splice(i, 1); continue; }
            if (!o.passed && o.z < c.obstacle.hitZ) {
                o.passed = true;
                const myLane = Math.round(this.playerLaneF);
                const jumping = this.jumpT >= 0 && this.jumpT > c.player.jumpSafeFrom && this.jumpT < c.player.jumpSafeTo;
                const sliding = this.slideT >= 0;
                let safe = false;
                if (o.lane !== myLane) safe = true;
                else if (o.type === 'rock') safe = jumping;
                else if (o.type === 'log') safe = sliding;
                if (!safe && this.invincible <= 0) {
                    // 受击分级：岩/横木首撞 → 踉跄（受击）；踉跄中再撞或撞墙 → 死亡
                    const canStumble = c.player.stumble.enabled && o.type !== 'wall' && !this.stumbling;
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
                else if (safe && o.lane === myLane) this.events.push({ type: 'obstaclePassed' });
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
                this.frags++;
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
    private spawnRow() {
        const c = this.cfg;
        // 生成避让：碎片带延伸至 spawnZ+lead+count*gap，整带需落在允许生成的直线段
        const front = this.dist + c.world.spawnZ;
        const back = front + c.spawn.fragmentLead + c.spawn.fragmentCount * c.spawn.fragmentGap;
        if (!this.mapGen.path.isSafeSpawnZone(front, 6) || !this.mapGen.path.isSafeSpawnZone(back, 2)) return;
        const lanesFree: number[] = [];
        for (let l = -this.laneMax; l <= this.laneMax; l++) lanesFree.push(l);
        const types: ObstacleType[] = ['rock', 'log', 'wall'];
        const n = this.rng.next() < c.spawn.singleRowChance ? 1 : 2;
        const used: number[] = [];
        for (let i = 0; i < n; i++) {
            const pick = lanesFree.splice(Math.floor(this.rng.next() * lanesFree.length), 1)[0];
            const t = types[Math.floor(this.rng.next() * types.length)];
            this.obstacles.push({ lane: pick, type: t, z: c.world.spawnZ, passed: false });
            used.push(pick);
        }
        if (this.rng.next() < c.spawn.fragmentChance) {
            const fl = lanesFree;   // 剩余未用车道
            if (fl.length) {
                const lane = fl[Math.floor(this.rng.next() * fl.length)];
                for (let k = 0; k < c.spawn.fragmentCount; k++) {
                    this.fragments.push({
                        lane,
                        z: c.world.spawnZ + c.spawn.fragmentLead + k * c.spawn.fragmentGap,
                        got: false,
                    });
                }
            }
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
