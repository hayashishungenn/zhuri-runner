import { describe, it, expect } from 'vitest';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { DEFAULT_CONFIG } from '../assets/scripts/config/GameConfigSchema';
import { Obstacle } from '../assets/scripts/core/types';

const CFG = DEFAULT_CONFIG;
const DT = 0.016;

function makeCore(seed = 42): GameCore {
    return new GameCore(CFG, new SeededRng(seed));
}

/** 固定步长推进 n 帧 */
function step(core: GameCore, n: number, dt = DT) {
    for (let i = 0; i < n; i++) core.update(dt);
}

function pushObstacle(core: GameCore, patch: Partial<Obstacle>): Obstacle {
    const o: Obstacle = { lane: 0, defId: 'rock', z: 0.6, passed: false, phase: 0, ...patch };
    core.obstacles.push(o);
    return o;
}

describe('状态机与流程', () => {
    it('初始为 title，输入无效', () => {
        const c = makeCore();
        expect(c.state).toBe('title');
        c.doLane(1); c.doJump(); c.doSlide();
        step(c, 10);
        expect(c.targetLane).toBe(0);
        expect(c.jumpT).toBe(-1);
        expect(c.slideT).toBe(-1);
    });

    it('startRun 进入 run 并重置', () => {
        const c = makeCore();
        c.startRun();
        expect(c.state).toBe('run');
        expect(c.dist).toBe(0);
        expect(c.speed).toBe(CFG.speed.base);
    });

    it('title/dead 期间不推进距离', () => {
        const c = makeCore();
        step(c, 30);
        expect(c.dist).toBe(0);
    });
});

describe('速度曲线与里程', () => {
    it('速度按 dist 增长并封顶', () => {
        const c = makeCore();
        c.startRun();
        // 帧首以当前 dist 计算速度，随后 dist += speed*dt
        const d0 = c.dist;
        step(c, 1);
        expect(c.speed).toBeCloseTo(CFG.speed.base + Math.min(d0 * CFG.speed.gain, CFG.speed.gainCap), 5);
        c.dist = 20000;    // 远超封顶点
        step(c, 1);
        expect(c.speed).toBeCloseTo(CFG.speed.base + CFG.speed.gainCap, 5);
    });

    it('里数 = dist × liScale', () => {
        const c = makeCore();
        c.dist = 100;
        expect(c.li).toBe(300);
    });

    it('跨越里程碑触发一次事件并推进', () => {
        const c = makeCore();
        c.startRun();
        c.dist = 332.5;            // 本帧推进后 li ≈ 998.8，未跨越
        c.update(DT);
        expect(c.drainEvents().filter((e) => e.type === 'milestone')).toHaveLength(0);
        c.dist = 333.4;            // 本帧推进后 li > 1000 → 跨越
        c.update(DT);
        const ms = c.drainEvents().filter((e) => e.type === 'milestone');
        expect(ms).toHaveLength(1);
        expect(ms[0].n).toBe(1000);
        expect(c.milestone).toBe(2000);
    });
});

describe('车道 / 跳跃 / 俯冲', () => {
    it('变道 clamp 到 ±1', () => {
        const c = makeCore();
        c.startRun();
        c.doLane(1); c.doLane(1); c.doLane(1);
        expect(c.targetLane).toBe(1);
        c.doLane(-1); c.doLane(-1); c.doLane(-1);
        expect(c.targetLane).toBe(-1);
    });

    it('变道缓动趋近目标', () => {
        const c = makeCore();
        c.startRun();
        c.doLane(1);
        step(c, 60);               // ~1s，lerp 11/s
        expect(c.playerLaneF).toBeGreaterThan(0.95);
    });

    it('跳跃生命周期：启动→推进→落回', () => {
        const c = makeCore();
        c.startRun();
        c.doJump();
        expect(c.jumpT).toBe(0);
        step(c, 1);
        expect(c.jumpT).toBeCloseTo(DT / CFG.player.jumpDuration, 5);
        step(c, 60);
        expect(c.jumpT).toBe(-1);  // 0.62s 后落地
    });

    it('俯冲：空中触发斩断到 diveJumpTo', () => {
        const c = makeCore();
        c.startRun();
        c.doJump();
        c.jumpT = 0.1;
        c.doSlide();
        expect(c.jumpT).toBe(CFG.player.diveJumpTo);
        expect(c.slideT).toBe(CFG.player.slideDuration);
    });

    it('俯冲计时结束归位', () => {
        const c = makeCore();
        c.startRun();
        c.doSlide();
        expect(c.slideT).toBeGreaterThan(0);
        step(c, Math.ceil(CFG.player.slideDuration / DT) + 2);
        expect(c.slideT).toBe(-1);
    });
});

/** 无敌跑 t 秒（用于撞墙等即死路径前的推进） */
describe('碰撞判定（Phase 1 受击分级）', () => {
    it('同车道 rock 未跳 → 受击踉跄（减速 + 豁免无敌 + 击碎障碍，不死亡）', () => {
        const c = makeCore();
        c.startRun();
        const o = pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('run');
        expect(c.stumbling).toBe(true);
        expect(c.stumbleTimer).toBeGreaterThan(0);
        expect(c.effectiveSpeed).toBeLessThan(c.speed);      // 减速生效
        expect(c.invincible).toBe(CFG.player.stumble.mercyInvincible);
        expect(o.z).toBeLessThan(CFG.world.despawnZ);        // 障碍被击碎
        expect(c.drainEvents().some((e) => e.type === 'stumble')).toBe(true);
    });

    it('踉跄中再撞 → 死亡', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.stumbling).toBe(true);
        // 豁免无敌 1.5s 内不会触发再撞判定的死亡路径？——踉跄期 1.8s > 豁免 1.5s，
        // 手动越过豁免窗口（推进时间）后再撞
        c.invincible = 0;
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('dying');
        expect(c.drainEvents().some((e) => e.type === 'crash')).toBe(true);
    });

    it('撞墙始终即死（踉跄不适用）', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'wall', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('dying');
        expect(c.timeScale).toBe(CFG.death.slowmo);
        expect(c.dieTimer).toBe(CFG.death.dieDelay);
    });

    it('stumble.enabled=false → 任何首撞即死（P0 行为等价开关）', () => {
        const cfg = JSON.parse(JSON.stringify(CFG));
        cfg.player.stumble.enabled = false;
        const c = new GameCore(cfg, new SeededRng(1));
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('dying');
    });

    it('踉跄结束后速度恢复公式值', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.effectiveSpeed).toBeLessThan(c.speed);
        step(c, Math.ceil(CFG.player.stumble.duration / DT) + 2);
        expect(c.stumbling).toBe(false);
        expect(c.effectiveSpeed).toBeCloseTo(c.speed, 5);
    });

    it('applySlowdown 非法参数抛错', () => {
        const c = makeCore();
        expect(() => c.applySlowdown(0, 1)).toThrow();
        expect(() => c.applySlowdown(1.5, 1)).toThrow();
        expect(() => c.applySlowdown(0.5, 0)).toThrow();
    });
});

describe('碰撞判定（跳/冲窗口）', () => {
    it('同车道 rock 未跳 → 受击踉跄', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.stumbling).toBe(true);
    });

    it('同车道 rock 空中（窗口内）→ 安全通过', () => {
        const c = makeCore();
        c.startRun();
        c.doJump();
        c.jumpT = 0.5;             // ∈ (0.12, 0.88)
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('run');
        expect(c.drainEvents().some((e) => e.type === 'obstaclePassed')).toBe(true);
    });

    it('跳跃窗口外（起跳太晚/落地太晚）→ 踉跄（未豁免）', () => {
        const c = makeCore();
        c.startRun();
        c.doJump();
        c.jumpT = 0.95;            // > jumpSafeTo
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);
        expect(c.stumbling).toBe(true);
        expect(c.state).toBe('run');
    });

    it('同车道 log 需俯冲（未俯冲→踉跄；俯冲→安全）', () => {
        const c1 = makeCore();
        c1.startRun();
        pushObstacle(c1, { lane: 0, defId: 'log', z: 0.6 });
        step(c1, 1);
        expect(c1.stumbling).toBe(true);

        const c2 = makeCore();
        c2.startRun();
        c2.doSlide();
        pushObstacle(c2, { lane: 0, defId: 'log', z: 0.6 });
        step(c2, 1);
        expect(c2.state).toBe('run');
        expect(c2.stumbling).toBe(false);
    });

    it('wall 跳跃不可穿越', () => {
        const c = makeCore();
        c.startRun();
        c.doJump();
        c.jumpT = 0.5;
        pushObstacle(c, { lane: 0, defId: 'wall', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('dying');
    });

    it('不同车道安全', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 1, defId: 'wall', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('run');
    });

    it('无敌期撞击 → 击碎障碍不死亡', () => {
        const c = makeCore();
        c.startRun();
        c.invincible = 1;
        const o = pushObstacle(c, { lane: 0, defId: 'wall', z: 0.6 });
        step(c, 1);
        expect(c.state).toBe('run');
        expect(o.z).toBeLessThan(CFG.world.despawnZ);
        expect(c.drainEvents().some((e) => e.type === 'obstacleSmashed')).toBe(true);
    });

    it('判定后障碍不再重复判定（passed）', () => {
        const c = makeCore();
        c.startRun();
        const o = pushObstacle(c, { lane: 0, defId: 'rock', z: 0.6 });
        step(c, 1);                // 安全通过
        c.doJump();
        c.jumpT = 0.5;
        c.invincible = 0;
        const before = c.state;
        step(c, 10);
        expect(c.state).toBe(before);
        expect(o.passed).toBe(true);
    });
});

describe('死亡与复活', () => {
    function toDead(): GameCore {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'wall', z: 0.6 });
        step(c, 1);
        // 慢动作计时推进至死亡结算
        step(c, 600);              // 10s 充裕覆盖 dieDelay/dieRate/slowmo 曲线
        return c;
    }

    it('dying 期间障碍冻结', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'wall', z: 0.6 });
        step(c, 1);                // crash（该帧 dist 已累计一次）
        expect(c.state).toBe('dying');
        const z = c.obstacles[0].z;
        const d = c.dist;
        step(c, 30);
        expect(c.obstacles[0].z).toBe(z);
        expect(c.dist).toBe(d);    // dying 期间不再计距
    });

    it('dying 结束进入 dead 并发事件', () => {
        const c = toDead();
        expect(c.state).toBe('dead');
        expect(c.drainEvents().some((e) => e.type === 'died')).toBe(true);
    });

    it('复活：清近处障碍、无敌、回到 run', () => {
        const c = toDead();
        expect(c.reviveUsable()).toBe(true);
        c.obstacles.push({ lane: 0, defId: 'rock', z: 10, passed: true, phase: 0 });
        c.obstacles.push({ lane: 1, defId: 'rock', z: 20, passed: true, phase: 0 });
        c.revive();
        expect(c.state).toBe('run');
        expect(c.reviveUsed).toBe(true);
        expect(c.reviveUsable()).toBe(false);
        expect(c.invincible).toBeCloseTo(CFG.player.reviveInvincible, 5);
        // z<=14 清除、z>14 保留
        expect(c.obstacles.map((o) => o.z)).toEqual([20]);
    });

    it('复活后无敌期衰减', () => {
        const c = toDead();
        c.revive();
        const inv0 = c.invincible;
        step(c, 30);
        expect(c.invincible).toBeLessThan(inv0);
    });

    it('重新起跑（startRun）重置全部状态', () => {
        const c = toDead();
        c.revive();
        c.startRun();
        expect(c.reviveUsed).toBe(false);
        expect(c.frags).toBe(0);
        expect(c.dist).toBe(0);
        expect(c.milestone).toBe(CFG.milestone.step);
        expect(c.obstacles).toHaveLength(0);
        expect(c.state).toBe('run');
    });
});

describe('阳炎拾取', () => {
    it('同车道且在拾取窗内 → +1 与事件', () => {
        const c = makeCore();
        c.startRun();
        c.fragments.push({ lane: 0, z: 0.8, got: false });
        step(c, 1);
        expect(c.frags).toBe(1);
        const ev = c.drainEvents().filter((e) => e.type === 'fragment');
        expect(ev).toHaveLength(1);
        expect(ev[0].lane).toBe(0);
        expect(c.fragments[0].got).toBe(true);
    });

    it('不同车道不拾取', () => {
        const c = makeCore();
        c.startRun();
        c.fragments.push({ lane: 1, z: 0.8, got: false });
        step(c, 1);
        expect(c.frags).toBe(0);
    });

    it('窗口外不拾取', () => {
        const c = makeCore();
        c.startRun();
        c.fragments.push({ lane: 0, z: 5, got: false });
        step(c, 1);                // 尚未到窗
        expect(c.frags).toBe(0);
    });
});

describe('生成规则（种子确定性）', () => {
    /** 模拟 run(t) 秒（全程无敌避免撞死），每帧快照新障碍行 */
    function simulate(seconds: number, seed = 7) {
        const c = makeCore(seed);
        c.startRun();
        c.invincible = 1e9;
        const rows: { z: number; lanes: number[] }[] = [];
        const frames = Math.ceil(seconds / DT);
        for (let i = 0; i < frames; i++) {
            c.update(DT);
            // 本帧新生成行：唯一可能出现在 (spawnZ - 本帧位移, spawnZ] 波段内的障碍
            const th = CFG.world.spawnZ - c.speed * DT - 0.001;
            const fresh = c.obstacles.filter((o) => o.z > th);
            if (fresh.length > 0) rows.push({ z: Math.max(...fresh.map((o) => o.z)), lanes: fresh.map((o) => o.lane) });
        }
        return { c, rows };
    }

    it('同一行障碍 ≤ 2 个（Phase 3：可达性由验证器保证，允许同 pass 障碍重叠车道）', () => {
        const { rows } = simulate(120);
        expect(rows.length).toBeGreaterThan(8);    // 采样足够（验证器拒绝重掷会抑制部分波）
        for (const r of rows) {
            expect(r.lanes.length).toBeLessThanOrEqual(2);
        }
    });

    it('障碍类型 ∈ {rock,log,wall}', () => {
        const { c } = simulate(30);
        for (const o of c.obstacles) {
            expect(['rock', 'log', 'wall']).toContain(o.defId);
        }
    });

    it('阳炎只生成在无障碍车道（同批）', () => {
        const { c } = simulate(120);
        // 不变式：与最新一排障碍（z 接近 spawnZ）同批的阳炎（z ≥ spawnZ，即 lead 之后的本批）
        // 不得与其同车道。阳炎行起点 = spawnZ + lead > spawnZ，只会属于本批或未来批。
        for (const o of c.obstacles) {
            if (o.z > CFG.world.spawnZ - CFG.speed.gainCap * DT - 0.001) {
                for (const f of c.fragments) {
                    if (f.z > CFG.world.spawnZ) expect(f.lane).not.toBe(o.lane);
                }
            }
        }
    });

    it('同种子完全一致（确定性）', () => {
        function runScript(seed: number) {
            const c = makeCore(seed);
            c.startRun();
            c.invincible = 1e9;    // 无敌跑完全程，聚焦生成/推进确定性
            for (let i = 0; i < 900; i++) {
                if (i % 90 === 0) c.doLane(i % 180 === 0 ? 1 : -1);
                if (i % 150 === 0) c.doJump();
                if (i % 210 === 0) c.doSlide();
                c.update(DT);
                c.drainEvents();
            }
            return {
                dist: c.dist, frags: c.frags, state: c.state,
                ob: c.obstacles.map((o) => [o.lane, o.defId, Math.round(o.z * 1000)]).sort(),
            };
        }
        const a = runScript(7), b = runScript(7), d = runScript(8);
        expect(a).toEqual(b);
        expect(a).not.toEqual(d);
    });

    it('障碍越过 despawnZ 被移除', () => {
        const c = makeCore();
        c.startRun();
        pushObstacle(c, { lane: 0, defId: 'rock', z: 0.3, passed: true });
        step(c, 12);               // (0.3+2)/13 ≈ 0.18s → 12 帧
        expect(c.obstacles).toHaveLength(0);
    });
});

describe('时间缩放（慢动作）', () => {
    it('title 下 timeScale 恢复到 1', () => {
        const c = makeCore();
        c.timeScale = 0.5;
        step(c, 150);              // 指数恢复（ambient 速率 3/s）
        expect(c.timeScale).toBeCloseTo(1, 2);
    });
});
