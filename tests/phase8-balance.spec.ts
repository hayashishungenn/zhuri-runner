/**
 * Phase 8 数值平衡模拟：新手/普通/熟练玩家各 100 局，比较无广告与广告翻倍路径。
 * 金产出来自核心实际拾取（非估算）；强化按实际花费表购买；输出供审查报告引用。
 */
import { describe, expect, it } from 'vitest';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';
import { UPGRADE_DEFS, Upgrades, UpgradeLevels } from '../assets/scripts/core/Upgrades';

const DT = 1 / 60;
const SKIN_COSTS: Record<string, number> = {
    xuanjia: 600, chiyan: 800, cangteng: 800, jinwu: 1200, weishui: 1000, huangmo: 1000, fusang: 2000,
};

type Skill = 'novice' | 'normal' | 'skilled';
const SKILL: Record<Skill, number> = { novice: 0.45, normal: 0.75, skilled: 0.95 };

interface SimResult {
    totalLi: number;
    totalFrags: number;
    gold: number;
    adGold: number;
    deaths: number;
    turns: number;
    firstUpgradeRun: number;
    upgradeLevels: number;
    skins: number;
}

function simulate(skill: Skill, ads: boolean, runs = 100, buyUpgrades = true): SimResult {
    const ai = new SeededRng(skill.length * 7919 + 7);   // 同技巧同种子：两组只差广告金币
    const p = SKILL[skill];
    const levels: UpgradeLevels = {};
    const up = new Upgrades(levels);
    let gold = 0, adGold = 0, totalLi = 0, totalFrags = 0, deaths = 0, turns = 0, firstUpgradeRun = 0;
    for (let seed = 1; seed <= runs; seed++) {
        const c = new GameCore(CFG, new SeededRng(seed * 31), { turnsEnabled: true });
        c.mods = {
            staffCapBonus: up.staffCapBonus(), waterReduceBonus: up.waterReduceBonus(),
            magnetBonus: up.magnetDurationBonus(), heatResist: up.heatResist(), goldMul: up.goldMul(),
        };
        c.startRun();
        for (let f = 0; f < 1800 && (c.state === 'run' || c.state === 'dying'); f++) {
            if (c.turnWindow && ai.next() < p) {
                if (c.tryTurn(c.turnWindow.dir)) turns++;
            }
            for (const o of c.obstacles) {
                if (o.passed || o.z > 5 || o.z < -2) continue;
                const lanes = c.obstacleLanes(o);
                if (!lanes.includes(Math.round(c.playerLaneF))) continue;
                const pass = c.catalog.obstacles.find((d) => d.id === o.defId)!.pass;
                if (ai.next() > p) continue;
                if (pass === 'jump' && c.jumpT < 0) c.doJump();
                else if (pass === 'slide') c.doSlide();
                else if (pass === 'lane' || pass === 'timing') {
                    const free = [-1, 0, 1].filter((l) => !lanes.includes(l));
                    if (free.length) c.doLane(free[0] > Math.round(c.playerLaneF) ? 1 : -1);
                }
            }
            c.update(DT);
            c.drainEvents();
        }
        if (c.state === 'dead' || c.state === 'dying') deaths++;
        totalLi += c.li;
        totalFrags += c.frags;
        const runGold = Math.round(c.frags * up.goldMul());
        gold += runGold;
        if (ads) adGold += runGold;                         // 结算金币 ×2 广告场景
        // 贪心购买（按目录顺序，先低价后高价）；隔离实验可关闭以排除强化反作用
        if (!buyUpgrades) continue;
        for (const def of UPGRADE_DEFS) {
            const lv = up.level(def.kind);
            if (lv >= def.maxLevel) continue;
            const cost = def.costs[lv];
            if (gold >= cost && up.apply(def.kind)) {
                gold -= cost;
                if (!firstUpgradeRun) firstUpgradeRun = seed + 1;
                break;
            }
        }
    }
    let skins = 0, budget = gold;
    for (const cost of Object.values(SKIN_COSTS).sort((a, b) => a - b)) {
        if (budget >= cost) { budget -= cost; skins++; }
    }
    return {
        totalLi, totalFrags, gold, adGold, deaths, turns, firstUpgradeRun,
        upgradeLevels: Object.values(levels).reduce((a, b) => a + b, 0), skins,
    };
}

describe('Phase 8 数值平衡（100 局 × 6 组合）', () => {
    const results: Record<string, SimResult> = {};
    for (const skill of ['novice', 'normal', 'skilled'] as const) {
        for (const ads of [false, true]) results[`${skill}:${ads ? 'ad' : 'noad'}`] = simulate(skill, ads);
    }

    it('输出成长/金币/强化/皮肤/广告影响实测数据', () => {
        for (const [k, r] of Object.entries(results)) {
            console.log(`[phase8-balance] ${k}: li=${r.totalLi.toFixed(0)} frags=${r.totalFrags} gold=${r.gold} adBonus=${r.adGold} deaths=${r.deaths}/100 turns=${r.turns} firstUpgrade=${r.firstUpgradeRun || '-'} upgrades=${r.upgradeLevels} skins=${r.skins}`);
        }
        expect(Object.values(results).every((r) => Number.isFinite(r.totalLi) && Number.isFinite(r.gold))).toBe(true);
    });

    it('无广告玩家可正常推进：普通/熟练玩家在 100 局内买到首个强化', () => {
        expect(results['normal:noad'].firstUpgradeRun).toBeGreaterThan(0);
        expect(results['skilled:noad'].firstUpgradeRun).toBeGreaterThan(0);
        expect(results['skilled:noad'].totalLi).toBeGreaterThan(results['novice:noad'].totalLi);
    });

    it('相同强化基线下广告只影响金币，不改变跑酷难度或可达性', () => {
        for (const skill of ['novice', 'normal', 'skilled'] as const) {
            const a = simulate(skill, false, 100, false);
            const b = simulate(skill, true, 100, false);
            expect(b.totalLi).toBe(a.totalLi);
            expect(b.deaths).toBe(a.deaths);
            expect(b.turns).toBe(a.turns);
            expect(b.gold).toBe(a.gold);
            expect(b.adGold).toBe(b.totalFrags);        // 广告金币仅来自结算翻倍
        }
    });

    it('熟练玩家 100 局可解锁至少一套皮肤或满级全部强化（无广告）', () => {
        const r = results['skilled:noad'];
        // 贪心策略先买满 10 级强化（总计 5750 金币），余款再买皮肤
        expect(r.skins >= 1 || (r.upgradeLevels >= 10 && r.gold >= 300)).toBe(true);
    });
});
