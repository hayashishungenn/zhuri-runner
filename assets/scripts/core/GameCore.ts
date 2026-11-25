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

export class GameCore {
    readonly cfg: GameConfig;

    // ---- 运行时状态（渲染器只读） ----
    state: GameState = 'title';
    gTime = 0;              // 全局时钟（贯穿标题/死亡，驱动天色与虚线动画）
    timeScale = 1;          // 慢动作系数
    dist = 0;               // 逻辑距离（里 = dist * liScale）
    frags = 0;              // 阳炎计数
    speed: number;
    runPhase = 0;           // 跑步动画相位
    playerLaneF = 0;        // 当前车道（浮点，缓动中）
    targetLane = 0;
    jumpT = -1;             // [-1]未跳；[0,1)跳跃进度
    slideT = -1;            // [-1]未俯冲；[0,slideDuration]剩余时间
    invincible = 0;         // 复活无敌剩余时间
    reviveUsed = false;
    milestone: number;
    dieTimer = -1;

    obstacles: Obstacle[] = [];
    fragments: Fragment[] = [];
    props: Prop[] = [];

    private spawnAcc: number;
    private propAcc = 0;
    private rng: Rng;
    private events: CoreEvent[] = [];

    constructor(cfg: GameConfig, rng?: Rng) {
        this.cfg = cfg;
        this.rng = rng ?? new SystemRng();
        this.speed = cfg.speed.base;
        this.milestone = cfg.milestone.step;
        this.spawnAcc = cfg.spawn.rowInterval * 0.5;   // P0 初值 4 = 半个生成间隔
    }

    get laneMax(): number { return Math.floor(this.cfg.world.laneCount / 2); }
    /** 里程（里） */
    get li(): number { return this.dist * this.cfg.milestone.liScale; }
    /** 天色进度 [0,1]（skyRange 里为全程） */
    get skyP(): number { return Math.min(this.li / this.cfg.milestone.skyRange, 1); }
    reviveUsable(): boolean { return !this.reviveUsed; }

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

    /** 死亡结算后的复活（广告发奖回调触发） */
    revive() {
        this.reviveUsed = true;
        // 清除近处障碍（z <= reviveKeepZ），保留远景
        this.obstacles = this.obstacles.filter((o) => o.z > this.cfg.player.reviveKeepZ);
        this.invincible = this.cfg.player.reviveInvincible;
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
    }

    // ---------- 输入意图 ----------
    doLane(dir: number) {
        if (this.state !== 'run') return;
        this.targetLane = Math.max(-this.laneMax, Math.min(this.laneMax, this.targetLane + dir));
    }
    doJump() {
        if (this.state !== 'run') return;
        if (this.jumpT < 0) this.jumpT = 0;
    }
    doSlide() {
        if (this.state !== 'run') return;
        // 空中俯冲：斩断跳跃，快速落地
        if (this.jumpT >= 0) this.jumpT = this.cfg.player.diveJumpTo;
        this.slideT = this.cfg.player.slideDuration;
    }

    // ---------- 主循环 ----------
    update(dtRaw: number) {
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
        this.dist += this.speed * dt;
        if (this.li >= this.milestone) {
            this.events.push({ type: 'milestone', n: this.milestone });
            this.milestone += c.milestone.step;
        }
        if (this.invincible > 0) this.invincible -= dt;
        this.playerLaneF += (this.targetLane - this.playerLaneF) * Math.min(1, dt * c.player.laneLerp);
        if (this.jumpT >= 0) { this.jumpT += dt / c.player.jumpDuration; if (this.jumpT >= 1) this.jumpT = -1; }
        if (this.slideT >= 0) { this.slideT -= dt; if (this.slideT < 0) this.slideT = -1; }
        this.runPhase += dt * (6 + this.speed * 0.35);

        // 生成
        this.spawnAcc += this.speed * dt;
        if (this.spawnAcc > c.spawn.rowInterval) { this.spawnAcc = 0; this.spawnRow(); }
        this.propAcc += this.speed * dt;
        if (this.propAcc > c.spawn.propInterval) { this.propAcc = 0; this.spawnProp(); }

        // 障碍推进 + 判定
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            o.z -= this.speed * dt;
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
                if (!safe && this.invincible <= 0) { this.crash(); return; }
                if (!safe && this.invincible > 0) { o.z = -3; this.events.push({ type: 'obstacleSmashed' }); }
                else if (safe && o.lane === myLane) this.events.push({ type: 'obstaclePassed' });
            }
        }
        // 阳炎拾取
        for (let i = this.fragments.length - 1; i >= 0; i--) {
            const f = this.fragments[i];
            f.z -= this.speed * dt;
            if (f.z < c.world.despawnZ) { this.fragments.splice(i, 1); continue; }
            if (!f.got && f.z < c.obstacle.pickupZTo && f.z > c.obstacle.pickupZFrom
                && Math.round(this.playerLaneF) === f.lane) {
                f.got = true;
                this.frags++;
                this.events.push({ type: 'fragment', lane: f.lane });
            }
        }
        for (let i = this.props.length - 1; i >= 0; i--) {
            this.props[i].z -= this.speed * dt;
            if (this.props[i].z < c.world.despawnZ) this.props.splice(i, 1);
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
