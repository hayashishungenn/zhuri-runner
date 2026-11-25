/**
 * Phase 2 测试：90° 转弯机制、生成避让、30 分钟自动奔跑、WorldShift。
 */
import { describe, it, expect } from 'vitest';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { WorldShift, Vec3Like } from '../assets/scripts/core/WorldShift';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';
import { validateConfig } from '../assets/scripts/config/GameConfigSchema';

const DT = 1 / 60;

function makeTurnCore(seed = 5): GameCore {
    return new GameCore(CFG, new SeededRng(seed), { turnsEnabled: true });
}

describe('90° 转弯机制', () => {
/** 推进到转弯窗口开启（无敌排除障碍干扰；转弯撞墙不受无敌豁免，不影响窗口验证），返回核心 */
    function runToWindow(seed = 5): GameCore {
        const c = makeTurnCore(seed);
        c.startRun();
        c.invincible = 1e9;
        let guard = 0;
        while (!c.turnWindow && guard < 60 * 120) {
            c.update(DT);
            c.drainEvents();
            guard++;
        }
        expect(c.turnWindow).not.toBeNull();
        return c;
    }

    it('转弯窗口开启：方向与路口记录一致', () => {
        const c = runToWindow(5);
        const corner = c.mapGen.corners.find((k) => !k.passed)!;
        expect(c.turnWindow!.dir).toBe(corner.dir);
        expect(c.turnWindow!.d).toBeCloseTo(corner.d, 6);
    });

    it('方向正确 → 通过路口（passed/cornersPassed，继续奔跑）', () => {
        const c = runToWindow(5);
        const dir = c.turnWindow!.dir;
        expect(c.tryTurn(dir)).toBe(true);
        expect(c.cornersPassed).toBe(1);
        expect(c.turnWindow).toBeNull();
        expect(c.drainEvents().some((e) => e.type === 'turnOk')).toBe(true);
        // 通过路口后继续奔跑越过弧线段，不触发撞墙
        const guardEnd = c.dist + 30;
        while (c.dist < guardEnd && c.state === 'run') {
            c.update(DT);
            c.drainEvents();
        }
        expect(c.state).toBe('run');
    });

    it('方向错误 → 立即撞墙死亡', () => {
        const c = runToWindow(5);
        const dir = c.turnWindow!.dir;
        expect(c.tryTurn((-dir) as 1 | -1)).toBe(false);
        expect(c.state).toBe('dying');
        expect(c.drainEvents().some((e) => e.type === 'turnMiss')).toBe(true);
    });

    it('错过窗口（不转向）→ 越过路口撞墙死亡', () => {
        const c = makeTurnCore(5);
        c.startRun();
        c.invincible = 1e9;                // 无敌不豁免撞墙：验证转弯失败路径本身
        let guard = 0;
        const seen = new Set<string>();
        while (c.state === 'run' && guard < 60 * 120) {
            c.update(DT);
            for (const e of c.drainEvents()) seen.add(e.type);
            guard++;
        }
        expect(c.state).not.toBe('run');       // 已撞墙
        expect(seen.has('turnMiss')).toBe(true);
        expect(seen.has('crash')).toBe(true);
    });

    it('窗口关闭后手势恢复切道语义（转向与切道互斥）', () => {
        const c = runToWindow(5);
        const dir = c.turnWindow!.dir;
        // 窗口内：tryTurn 消费转向（Game 层把滑动手势路由到此），成功后窗口关闭
        expect(c.tryTurn(dir)).toBe(true);
        expect(c.turnWindow).toBeNull();
        // 窗口关闭：同一手势恢复普通切道语义
        const before = c.targetLane;
        c.doLane(dir);
        expect(c.targetLane).toBe(Math.max(-1, Math.min(1, before + dir)));
    });
});

describe('生成避让（弯道/特殊地块内无障碍）', () => {
    it('长跑后所有现存障碍的生成点均在安全区内', () => {
        const c = makeTurnCore(9);
        c.startRun();
        c.invincible = 1e9;
        const rng = new SeededRng(31);
        for (let i = 0; i < 60 * 90; i++) {          // 90s
            if (c.turnWindow) c.tryTurn(c.turnWindow.dir);
            if (rng.next() < DT / 0.8) {
                const r = rng.next();
                if (r < 0.4) c.doLane(r < 0.2 ? -1 : 1);
                else if (r < 0.7) c.doJump();
                else c.doSlide();
            }
            c.update(DT);
            c.drainEvents();
        }
        // dist + o.z == 生成时刻的绝对距离（不变式）
        for (const o of c.obstacles) {
            expect(c.path.isSafeSpawnZone(c.dist + o.z, 6)).toBe(true);
        }
        for (const f of c.fragments) {
            expect(c.path.isSafeSpawnZone(c.dist + f.z, 2)).toBe(true);
        }
    });
});

describe('WorldShift 原点重定位', () => {
    it('超过阈值触发重定位，渲染坐标保持有界', () => {
        const ws = new WorldShift();
        const p: Vec3Like = { x: 100, y: 0, z: -200 };
        expect(ws.maybeRebase(p, 4000)).toBe(false);
        const far: Vec3Like = { x: 9000, y: 0, z: -30000 };
        expect(ws.maybeRebase(far, 4000)).toBe(true);
        const r = ws.toRender(far);
        expect(Math.abs(r.x)).toBeLessThanOrEqual(4000);
        expect(Math.abs(r.z)).toBeLessThanOrEqual(4000);
    });

    it('重定位保持相对位移不变（平移坐标系）', () => {
        const ws = new WorldShift();
        const a: Vec3Like = { x: 5000, y: 2, z: -8000 };
        const b: Vec3Like = { x: 5010, y: 2, z: -8020 };
        const d0 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        ws.maybeRebase(a, 4000);
        const ra = ws.toRender(a), rb = ws.toRender(b);
        expect(rb.x - ra.x).toBeCloseTo(d0.x, 6);
        expect(rb.y - ra.y).toBeCloseTo(d0.y, 6);
        expect(rb.z - ra.z).toBeCloseTo(d0.z, 6);
    });

    it('连续重定位多次仍正确', () => {
        const ws = new WorldShift();
        let rebaseCount = 0;
        for (let i = 0; i < 100; i++) {
            const p: Vec3Like = { x: i * 500, y: 0, z: -i * 400 };
            if (ws.maybeRebase(p, 4000)) rebaseCount++;
            const r = ws.toRender(p);
            expect(Math.abs(r.x)).toBeLessThanOrEqual(4000 + 1);
            expect(Math.abs(r.z)).toBeLessThanOrEqual(4000 + 1);
        }
        expect(rebaseCount).toBeGreaterThanOrEqual(10);
    });
});

describe('Phase 2 配置校验', () => {
    it('随包 JSON 的 map 段合法', () => {
        expect(validateConfig(CFG)).toEqual([]);
    });
    it('转弯间隔倒置 / horizon 过小被拒绝', () => {
        const o = JSON.parse(JSON.stringify(CFG));
        o.map.turnGapMin = 200;
        o.map.turnGapMax = 100;
        expect(validateConfig(o).some((e) => e.includes('turnGap'))).toBe(true);
        const o2 = JSON.parse(JSON.stringify(CFG));
        o2.map.horizon = 50;
        expect(validateConfig(o2).some((e) => e.includes('horizon'))).toBe(true);
    });
});

describe('30 分钟自动奔跑压测（任务书要求）', () => {
    it('1800s×60fps：转弯/死亡/重开全流程，地块与对象数量有界，精度有界', () => {
        const c = makeTurnCore(2025);
        const ws = new WorldShift();
        c.startRun();
        const rng = new SeededRng(2026);
        const frames = 1800 / DT;                    // 108000 帧
        let maxSegs = 0, maxOb = 0, maxFr = 0, maxPr = 0;
        let cumDist = 0, deaths = 0, turnsOk = 0, turnsMissed = 0;
        let sampleChecks = 0;

        for (let i = 0; i < frames; i++) {
            // 自动驾驶：转向（含 10% 故意转错）+ 随机动作
            if (c.turnWindow) {
                const wrong = rng.next() < 0.1;
                const dir = c.turnWindow.dir;
                c.tryTurn(wrong ? ((-dir) as 1 | -1) : dir);
            } else if (rng.next() < DT / 0.7) {
                const r = rng.next();
                if (r < 0.4) c.doLane(r < 0.2 ? -1 : 1);
                else if (r < 0.75) c.doJump();
                else c.doSlide();
            }
            c.update(DT);
            for (const e of c.drainEvents()) {
                if (e.type === 'turnOk') turnsOk++;
                if (e.type === 'turnMiss') turnsMissed++;
                if (e.type === 'died') {
                    cumDist += c.dist;
                    deaths++;
                    c.startRun();
                    ws.shift.x = 0; ws.shift.z = 0;   // 重开 = 场景重建，shift 归零
                }
            }
            maxSegs = Math.max(maxSegs, c.path.segments.length);
            maxOb = Math.max(maxOb, c.obstacles.length);
            maxFr = Math.max(maxFr, c.fragments.length);
            maxPr = Math.max(maxPr, c.props.length);
            // 每 2s 校验一次采样有限性与重定位有效性
            if (i % 120 === 0) {
                const p = c.path.sample(c.dist, 0);
                expect(Number.isFinite(p.x)).toBe(true);
                expect(Number.isFinite(p.z)).toBe(true);
                ws.maybeRebase(p);
                const r = ws.toRender(p);
                expect(Math.abs(r.x)).toBeLessThanOrEqual(4100);
                expect(Math.abs(r.z)).toBeLessThanOrEqual(4100);
                sampleChecks++;
            }
        }
        // 数量上界（防泄漏）
        expect(maxSegs).toBeLessThan(60);            // horizon 300 / 段长 ~20
        expect(maxOb).toBeLessThanOrEqual(16);
        expect(maxFr).toBeLessThanOrEqual(42);
        expect(maxPr).toBeLessThanOrEqual(30);
        // 流程量：1800s 必然经历大量路口与若干死亡重开
        expect(turnsOk + turnsMissed).toBeGreaterThan(50);
        expect(turnsOk).toBeGreaterThan(turnsMissed);      // 自动驾驶成功率 90%
        expect(deaths).toBeGreaterThan(0);
        expect(sampleChecks).toBeGreaterThan(800);
        expect(cumDist).toBeGreaterThan(1800 * 8);   // 30 分钟累计里程下限（频繁死亡重开仍应跑出量级）
        expect(c.gTime).toBeGreaterThan(0);
    }, 120000);
});
