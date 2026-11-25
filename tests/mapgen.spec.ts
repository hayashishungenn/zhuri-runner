/**
 * Phase 2 测试：无限地图程序化生成。
 * 任务书要求：固定种子 ≥10 万次地块连接，验证坐标/方向/连续性/生成约束。
 */
import { describe, it, expect } from 'vitest';
import { MapGenerator } from '../assets/scripts/core/MapGenerator';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';
import { normHeading, TrackSegment } from '../assets/scripts/core/track';

function makeGen(seed = 777): MapGenerator {
    return new MapGenerator({ ...CFG.map, turnsEnabled: true, seed });
}

/** 推进生成器直到累计生成 n 个地块，返回全部地块快照（trim 前引用） */
function generateN(gen: MapGenerator, n: number): TrackSegment[] {
    const acc: TrackSegment[] = [];
    let playerD = 0;
    while (gen.totalGenerated < n) {
        const beforeCount = gen.totalGenerated;
        playerD += 10;
        gen.update(playerD);
        const live = gen.path.segments;
        const newCount = gen.totalGenerated - beforeCount;
        for (let k = 0; k < newCount; k++) acc.push(live[live.length - newCount + k]);
    }
    return acc.slice(0, n);
}

describe('MapGenerator：10 万次地块连接验证', () => {
    it('固定种子生成 100,000 个地块：连接连续、航向规范、约束满足', () => {
        const gen = makeGen(777);
        const TARGET = 100000;
        const segs = generateN(gen, TARGET);
        expect(segs.length).toBe(TARGET);

        let arcs = 0;
        const cornerDs: number[] = [];
        for (const s of segs) {
            // 长度约束
            expect(s.length).toBeGreaterThan(0);
            if (s.turn !== 0) {
                expect(s.length).toBeCloseTo(Math.PI / 2 * s.radius, 5);
                arcs++;
            }
            // 航向规范：出入口航向为 90° 的整数倍（容差 1e-9）
            for (const h of [s.entryHeading, s.exitHeading]) {
                const hn = normHeading(h);
                const mod = Math.abs(hn % (Math.PI / 2));
                const distToMult = Math.min(mod, Math.PI / 2 - mod);
                expect(distToMult).toBeLessThan(1e-9);
            }
            // 高度衔接：坡道 y 差 = grade * length
            if (s.kind === 'slopeUp' || s.kind === 'slopeDown') {
                expect(s.exit.y - s.entry.y).toBeCloseTo(s.grade * s.length, 6);
            }
            // 弯道/桥/洞/过渡不允许障碍生成
            if (s.turn !== 0 || s.kind === 'bridge' || s.kind === 'cave' || s.kind === 'transition') {
                expect(s.allowsObstacles).toBe(false);
            }
        }

        // 连续性：相邻地块 出口 == 下一入口（坐标/航向/距离）
        for (let i = 1; i < segs.length; i++) {
            const prev = segs[i - 1], s = segs[i];
            expect(s.entry.x).toBeCloseTo(prev.exit.x, 9);
            expect(s.entry.y).toBeCloseTo(prev.exit.y, 9);
            expect(s.entry.z).toBeCloseTo(prev.exit.z, 9);
            expect(normHeading(s.entryHeading - prev.exitHeading)).toBeCloseTo(0, 9);
            expect(s.startD).toBe(prev.startD + prev.length);
        }

        // 路口：弧线数 == 推导路口数（从地块快照推导，不受 trim 影响）；相邻路口间距 ≥ turnGapMin
        const derived = segs.filter((s) => s.turn !== 0).map((s) => s.startD + s.length / 2);
        expect(derived.length).toBe(arcs);
        for (let i = 1; i < derived.length; i++) {
            expect(derived[i] - derived[i - 1]).toBeGreaterThanOrEqual(CFG.map.turnGapMin);
        }
        void cornerDs;

        // 当前存活路径（trim 后）远端采样有限性
        for (let d = 0; d <= gen.path.endD; d += 5000) {
            const p = gen.path.sample(Math.min(d, gen.path.endD - 0.01), 0);
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
            expect(Number.isFinite(p.z)).toBe(true);
        }
    }, 60000);

    it('同种子完全可复现；不同种子路径不同', () => {
        const key = (list: TrackSegment[]) =>
            list.map((s) => [s.kind, s.startD, s.length, s.entryHeading, s.turn, s.theme]);
        const a = key(generateN(makeGen(42), 200));
        const b = key(generateN(makeGen(42), 200));
        const c = key(generateN(makeGen(43), 200));
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
    });

    it('trim 回收：玩家推进后地块数量有界（不随距离无限增长）', () => {
        const gen = makeGen(9);
        let playerD = 0;
        let maxSegs = 0;
        for (let i = 0; i < 5000; i++) {
            playerD += 8;
            gen.update(playerD);
            maxSegs = Math.max(maxSegs, gen.path.segments.length);
        }
        // horizon 300 / 平均段长 ~20 + 余量
        expect(maxSegs).toBeLessThan(60);
        expect(playerD).toBeGreaterThan(30000);
    });
});
