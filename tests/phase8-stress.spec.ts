/**
 * Phase 8 压力测试：≥1000 局不同种子/速度/难度、600s 长跑、1000 次重开、
 * 1000 次暂停恢复、资源与帧时间上界。
 *
 * 边界声明（Phase 8.1 明确）：
 * 本测试使用无敌模式仅用于验证生成管线、数组有界、资源回收与长跑稳定性，
 * 绝不用于证明地图可达性或碰撞公平性（真实无无敌 1000 种子重放见 phase8-1-engine.spec.ts）。
 */
import { describe, expect, it } from 'vitest';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { DEFAULT_CONFIG as BASE } from '../assets/scripts/config/GameConfigSchema';

const DT = 1 / 60;

function cfgFor(profile: 'slow' | 'normal' | 'fast') {
    const c = JSON.parse(JSON.stringify(BASE));
    if (profile === 'slow') { c.speed.base = 8; c.difficulty.rampLi = 6000; }
    if (profile === 'fast') { c.speed.base = 20; c.speed.gain = 0.06; c.difficulty.rampLi = 1000; }
    return c;
}

function pct(a: number[], p: number): number {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

describe('Phase 8 压力与资源回收', () => {
    it('1000 局不同种子/速度/难度：无异常、数组有界、事件可达性持续生效', () => {
        const t0 = performance.now();
        let frames = 0, deaths = 0, maxObs = 0, maxFrag = 0, maxItems = 0, maxProps = 0;
        let validated = 0, rejects = 0;
        for (let seed = 1; seed <= 1000; seed++) {
            const profile = (['slow', 'normal', 'fast'] as const)[seed % 3];
            const c = new GameCore(cfgFor(profile), new SeededRng(seed), { turnsEnabled: true });
            c.startRun();
            for (let f = 0; f < 600 && (c.state === 'run' || c.state === 'dying'); f++) {
                c.invincible = 1e6;                       // 隔离碰撞，专测生成/地图/转弯稳定性
                if (c.turnWindow) c.tryTurn(c.turnWindow.dir);
                c.update(DT);
                const evs = c.drainEvents();
                expect(evs.length).toBeLessThan(50);
                frames++;
                maxObs = Math.max(maxObs, c.obstacles.length);
                maxFrag = Math.max(maxFrag, c.fragments.length);
                maxItems = Math.max(maxItems, c.items.length);
                maxProps = Math.max(maxProps, c.props.length);
                expect(Number.isFinite(c.dist)).toBe(true);
                expect(Number.isFinite(c.heat)).toBe(true);
            }
            if (c.state === 'dead' || c.state === 'dying') deaths++;
            validated += c.waveStats.validated;
            rejects += c.waveStats.rejected;
        }
        const ms = performance.now() - t0;
        console.log(`[phase8-stress] 1000局 frames=${frames} deaths=${deaths} maxObs=${maxObs} maxFrag=${maxFrag} maxItems=${maxItems} maxProps=${maxProps} validated=${validated} rejected=${rejects} ${ms.toFixed(0)}ms`);
        expect(frames).toBeGreaterThan(100000);
        expect(maxObs).toBeLessThan(80);
        expect(maxFrag).toBeLessThan(80);
        expect(maxItems).toBeLessThan(20);
        expect(maxProps).toBeLessThan(30);
        expect(validated).toBeGreaterThan(1000);
    }, 60000);

    it('600s 连续奔跑：对象有界、帧时间可测、无 NaN', () => {
        const c = new GameCore(cfgFor('fast'), new SeededRng(99), { turnsEnabled: false });
        c.startRun();
        const times: number[] = [];
        let maxObs = 0, maxFrag = 0, maxProps = 0, maxCorners = 0;
        for (let f = 0; f < 36000; f++) {
            c.invincible = 1e6;
            const t = performance.now();
            c.update(DT);
            c.drainEvents();
            times.push(performance.now() - t);
            maxObs = Math.max(maxObs, c.obstacles.length);
            maxFrag = Math.max(maxFrag, c.fragments.length);
            maxProps = Math.max(maxProps, c.props.length);
            maxCorners = Math.max(maxCorners, c.mapGen.corners.length);
        }
        console.log(`[phase8-stress] 600s dist=${c.dist.toFixed(0)} li=${c.li.toFixed(0)} frame p50=${pct(times, 0.5).toFixed(4)}ms p95=${pct(times, 0.95).toFixed(4)}ms p99=${pct(times, 0.99).toFixed(4)}ms max=${Math.max(...times).toFixed(3)}ms objs=${maxObs}/${maxFrag}/${maxProps} corners=${maxCorners}`);
        expect(c.state).toBe('run');
        expect(maxObs).toBeLessThan(80);
        expect(maxFrag).toBeLessThan(80);
        expect(maxProps).toBeLessThan(30);
        expect(maxCorners).toBeLessThan(60);
        expect(pct(times, 0.99)).toBeLessThan(20);       // Node 逻辑层，不含渲染
    });

    it('1000 次重新开局：状态与容器回到初值，无累积', () => {
        const c = new GameCore(BASE, new SeededRng(7), { turnsEnabled: true });
        for (let i = 0; i < 1000; i++) {
            c.startRun();
            for (let f = 0; f < 30; f++) { c.invincible = 1e6; if (c.turnWindow) c.tryTurn(c.turnWindow.dir); c.update(DT); }
            c.drainEvents();
            if (i % 100 === 0) {
                expect(c.state).toBe('run');
                expect(Number.isFinite(c.dist)).toBe(true);
            }
        }
        c.startRun();
        expect(c.dist).toBe(0);
        expect(c.frags).toBe(0);
        expect(c.items).toHaveLength(0);
        expect(c.reviveUsed).toBe(false);
        expect(c.cornersPassed).toBe(0);
    });

    it('1000 次暂停/恢复：暂停帧完全冻结状态', () => {
        const c = new GameCore(BASE, new SeededRng(11));
        c.startRun();
        for (let i = 0; i < 1000; i++) {
            if (c.state !== 'run') { c.startRun(); c.invincible = 1e6; }
            c.invincible = 1e6;                // 隔离碰撞，专测暂停冻结
            const d = c.dist, g = c.gTime;
            c.pause();
            for (let f = 0; f < 5; f++) c.update(DT);
            expect(c.dist).toBe(d);
            expect(c.gTime).toBe(g);
            c.resume();
            c.update(DT);
        }
        expect(c.dist).toBeGreaterThan(0);
    });
});
