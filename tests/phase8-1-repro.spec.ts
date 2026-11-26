/**
 * Phase 8.1 最小复现测试（修复前验证缺陷真实存在，修复后作为回归测试守护）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { parseCatalog } from '../assets/scripts/config/ObstacleCatalog';
import { validateReachability, abilityForSpeed } from '../assets/scripts/core/Reachability';
import { RunLedger } from '../assets/scripts/core/RunLedger';
import { PlayerStats } from '../assets/scripts/core/PlayerStats';
import { DEFAULT_CONFIG as BASE } from '../assets/scripts/config/GameConfigSchema';
import {
    Save, Storage, KEY_SAVE, parseSave, serializeSave, defaultSaveData,
} from '../assets/scripts/platform/Save';

const REAL_CATALOG = parseCatalog(JSON.parse(readFileSync(resolve(__dirname, '../assets/resources/obstacle-catalog.json'), 'utf8')));

function cloneCfg() {
    return JSON.parse(JSON.stringify(BASE));
}

class MemStorage implements Storage {
    map = new Map<string, string>();
    get(k: string): string | null { return this.map.get(k) ?? null; }
    set(k: string, v: string): void { this.map.set(k, v); }
}

describe('Phase 8.1 缺陷最小复现', () => {
    it('BUG-01: 20 FPS 下 dt 截断导致模拟时间严重丢失且跨帧率不一致', () => {
        const c60 = new GameCore(cloneCfg(), new SeededRng(42));
        const c20 = new GameCore(cloneCfg(), new SeededRng(42));
        c60.startRun();
        c20.startRun();
        for (let i = 0; i < 600; i++) c60.update(1 / 60); // 10s
        for (let i = 0; i < 200; i++) c20.update(1 / 20); // 10s
        // 修复后应一致：均推进 10s，dist 完全一致
        expect(c20.gTime).toBeCloseTo(10, 2);
        expect(c20.dist).toBeCloseTo(c60.dist, 4);
    });

    it('BUG-02: spawnWave 中 maxDz 未加 this.dist 导致模板后段障碍落入非安全地块', () => {
        const cfg = cloneCfg();
        const c = new GameCore(cfg, new SeededRng(7), { turnsEnabled: true, catalog: REAL_CATALOG });
        c.startRun();
        // 推进到 tier >= 1（解锁 hopChain/hopSlide 等 dz=10..18 模板），找到前方非安全地块
        c.mapGen.update(1200);
        const unsafeSeg = c.path.segments.find((s) => !s.allowsObstacles && s.startD > 800);
        expect(unsafeSeg).toBeDefined();
        // front = targetDist + spawnZ 在安全区，且 back = front + 9.1 也在安全区，但 front + 18 落入 unsafeSeg
        const targetDist = unsafeSeg!.startD - cfg.world.spawnZ - 12;
        c.dist = targetDist;
        c.mapGen.update(c.dist);
        let badSpawns = 0;
        for (let i = 0; i < 80; i++) {
            c.obstacles = [];
            (c as unknown as { spawnWave: () => boolean }).spawnWave();
            for (const o of c.obstacles) {
                const absD = c.dist + o.z;
                if (!c.path.segmentAt(absD).allowsObstacles) badSpawns++;
            }
        }
        expect(badSpawns).toBe(0);
    });

    it('BUG-03: Reachability 未合并同距离事件，导致可通行的同排多障碍组合误判', () => {
        const ab = abilityForSpeed(20, { laneLerp: 11, jumpDuration: 0.62, slideDuration: 0.55, reactionTime: 0.3 });
        // fireCorridor: d=100 上 -1 跳、0 墙、1 跳 —— 在 -1 或 1 车道起跳即可通过
        const r = validateReachability([
            { d: 100, lanes: [-1], pass: 'jump' },
            { d: 100, lanes: [0], pass: 'lane' },
            { d: 100, lanes: [1], pass: 'jump' },
        ], ab);
        expect(r.reachable).toBe(true);
    });

    it('BUG-04: 高速冲刺下拾取窗口防穿透（碎片不因单帧跨过 pickupZ 漏拾）', () => {
        const c = new GameCore(cloneCfg(), new SeededRng(1));
        c.startRun();
        c.dist = 2000;
        c.dashT = 3;
        c.fragments = [{ lane: 0, z: 0.91, got: false }];
        // 单次 0.033s 更新：dash 速度 ~43.5，位移 1.4355 > 拾取窗宽 1.4（0.91 -> -0.5255）
        c.update(0.033);
        expect(c.frags).toBeGreaterThan(0);
    });

    it('BUG-05a: 错过转弯触发 crash 后不得继续推进当帧玩法逻辑（不能同帧触发 journeyDone）', () => {
        const cfg = cloneCfg();
        const c = new GameCore(cfg, new SeededRng(1), { turnsEnabled: true, mode: 'journey' });
        c.startRun();
        c.mapGen.update(500);
        const corner = c.mapGen.corners[0];
        expect(corner).toBeDefined();
        c.dist = corner.d - 1;
        c.update(1 / 60); // 进入 turnWindow
        expect(c.turnWindow).not.toBeNull();
        // 把 dist 推进到刚超过 corner.d + 0.6 且同时满足 journey 终点
        const finalD = cfg.journey.stages[cfg.journey.stages.length - 1].goalLi / cfg.milestone.liScale;
        c.dist = Math.max(corner.d + 0.7, finalD + 1);
        c.update(1 / 60);
        expect(c.state).toBe('dying');
        expect(c.drainEvents().some((e) => e.type === 'journeyDone')).toBe(false);
    });

    it('BUG-05b: 错过转弯复活后，旧路口不得永久阻塞后续路口；转错方向复活后不得立刻再次死亡', () => {
        const cfg = cloneCfg();
        const c = new GameCore(cfg, new SeededRng(1), { turnsEnabled: true });
        c.startRun();
        c.mapGen.update(600);
        expect(c.mapGen.corners.length).toBeGreaterThanOrEqual(2);
        const c0 = c.mapGen.corners[0];
        const c1 = c.mapGen.corners[1];
        // 在 c0 处转错方向
        c.dist = c0.d - 1;
        c.update(1 / 60);
        expect(c.turnWindow).not.toBeNull();
        c.tryTurn((c0.dir === 1 ? -1 : 1) as 1 | -1);
        expect(c.state).toBe('dying');
        for (let i = 0; i < 120 && c.state !== 'dead'; i++) c.update(1 / 60);
        expect(c.state).toBe('dead');
        // 复活
        expect(c.revive()).toBe(true);
        // 复活后继续跑 30 帧不应立刻因旧 turnWindow 再次死亡
        for (let i = 0; i < 30; i++) c.update(1 / 60);
        expect(c.state).toBe('run');
        // 推进到下一个路口 c1，必须能正常打开新的 turnWindow
        c.dist = c1.d - 2;
        c.update(1 / 60);
        expect(c.turnWindow).not.toBeNull();
        expect(c.turnWindow!.d).toBeCloseTo(c1.d, 2);
    });

    it('BUG-06: 同种子重新开局可完全复现且残留状态（gTime/difficulty/events）全部重置', () => {
        const c = new GameCore(cloneCfg(), new SeededRng(123), { turnsEnabled: true });
        c.startRun();
        for (let i = 0; i < 120; i++) c.update(1 / 60);
        const snap1 = { dist: c.dist, obs: c.obstacles.map((o) => ({ defId: o.defId, lane: o.lane, z: o.z })) };
        // 留一些未消费事件与高难度
        c.dist = 3000;
        c.update(1 / 60);
        c.startRun();
        expect(c.runTime).toBe(0);
        expect(c.fixedTick).toBe(0);
        expect(c.mapGen.difficulty).toBe(0);
        expect(c.drainEvents()).toHaveLength(0);
        for (let i = 0; i < 120; i++) c.update(1 / 60);
        const snap2 = { dist: c.dist, obs: c.obstacles.map((o) => ({ defId: o.defId, lane: o.lane, z: o.z })) };
        expect(snap2).toEqual(snap1);
    });

    it('BUG-07: 金币倍率逐枚拾取不因单枚四舍五入丢失加成', () => {
        const ledger = new RunLedger();
        ledger.beginRun(false);
        let total = 0;
        for (let f = 1; f <= 20; f++) {
            const g = ledger.fragmentGrant(f, 1.3);
            if (g) total += g.amount;
        }
        // 20 * 1.3 = 26（修复前每枚 Math.round(1.3)=1，仅得 20）
        expect(total).toBe(26);
    });

    it('BUG-07b: coolRuns 成就仅在全程未过热时计入', () => {
        const st = defaultSaveData().stats;
        const ps = new PlayerStats(st);
        // 过热通关（isCoolRun = false）不得计入 coolRuns
        ps.onRunSettle(6000, 10, 10, 'ended', 3, 3, false);
        expect(st.coolRuns).toBe(0);
        // 清凉通关（isCoolRun = true）正常计入
        ps.onRunSettle(6000, 10, 10, 'ended', 3, 3, true);
        expect(st.coolRuns).toBe(1);
    });

    it('BUG-09: 教程配置覆盖必须作用于 MapGenerator 且不得修改共享 cfg 对象', () => {
        const cfg = cloneCfg();
        const origInterval = cfg.spawn.rowInterval;
        const origGapMax = cfg.map.turnGapMax;
        const c = new GameCore(cfg, new SeededRng(5), { turnsEnabled: true });
        const ledger = new RunLedger();
        const { runId, overrides } = ledger.beginRun(true);
        c.startRun({ seed: runId, overrides });
        expect(cfg.spawn.rowInterval).toBe(origInterval);
        expect(cfg.map.turnGapMax).toBe(origGapMax);
        expect(c.mapGen.activeCfg.turnGapMax).toBe(60);
        expect(c.rowIntervalNow()).toBeGreaterThanOrEqual(16 * (1 - 0.55 * c.difficulty) - 1e-6);
    });

    it('BUG-10: 存档字段范围校验、不兼容高版本禁止静默覆盖、存储异常不崩溃', () => {
        // 1) 非法字段值（即使校验和合法）应被清洗到合法范围
        const bad = defaultSaveData();
        bad.gold = -999;
        bad.bestLi = -50;
        bad.skinsOwned = [];
        bad.skin = 'nonexistent';
        bad.upgrades = { staff: 99, water: -3 };
        const parsed = parseSave(serializeSave(bad));
        expect(parsed).not.toBeNull();
        expect(parsed!.gold).toBe(0);
        expect(parsed!.bestLi).toBe(0);
        expect(parsed!.skinsOwned).toContain('kuafu');
        expect(parsed!.skin).toBe('kuafu');
        expect(parsed!.upgrades.staff).toBeLessThanOrEqual(2);
        expect(parsed!.upgrades.water).toBe(0);

        // 2) 高版本存档（v: 3）禁止被静默覆盖为 v: 2 空档
        const st = new MemStorage();
        const futureRaw = JSON.stringify({ v: 3, gold: 99999, checksum: 'future' });
        st.set(KEY_SAVE, futureRaw);
        const s = new Save(st);
        expect(st.get(KEY_SAVE)).toBe(futureRaw);
        void s;

        // 3) 存储写入抛异常时不崩溃
        const throwingStorage: Storage = {
            get: () => null,
            set: () => { throw new Error('QuotaExceededError'); },
        };
        expect(() => new Save(throwingStorage)).not.toThrow();
    });
});
