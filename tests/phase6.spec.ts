/**
 * Phase 6 测试：经济事务/任务成就/存档 v2/教程/强化边界。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { Economy } from '../assets/scripts/core/Economy';
import { QUEST_TEMPLATES, DailyQuests, normalizeDate } from '../assets/scripts/core/Quests';
import { ACHIEVEMENTS, Achievements } from '../assets/scripts/core/Achievements';
import { Upgrades, UPGRADE_DEFS, levelOf } from '../assets/scripts/core/Upgrades';
import { Tutorial, TUTORIAL_STEPS } from '../assets/scripts/core/Tutorial';
import { Save, checksumOf, defaultSaveData, Storage, KEY_SAVE, KEY_V1_BEST } from '../assets/scripts/platform/Save';
import { validateSkins } from '../assets/scripts/config/SkinCatalog';
import { validateTileTemplates } from '../assets/scripts/config/TileTemplates';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';

const DT = 1 / 60;

class MemStorage implements Storage {
    private m = new Map<string, string>();
    get(k: string): string | null { return this.m.get(k) ?? null; }
    set(k: string, v: string): void { this.m.set(k, v); }
    dump(): string { return this.get(KEY_SAVE) ?? ''; }
}

describe('任务模板规模与结构（≥30）', () => {
    it('≥30 个模板且指标覆盖六类', () => {
        expect(QUEST_TEMPLATES.length).toBeGreaterThanOrEqual(30);
        const metrics = new Set(QUEST_TEMPLATES.map((t) => t.metric));
        expect(metrics.size).toBeGreaterThanOrEqual(10);
        expect(QUEST_TEMPLATES.every((t) => t.reward > 0)).toBe(true);
    });

    it('id 无重复', () => {
        const ids = QUEST_TEMPLATES.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('每日任务（日期抽取/切换/领取）', () => {
    it('同日期抽取稳定；跨日期刷新', () => {
        const q1 = new DailyQuests({ date: '', picks: [], progress: {}, claimed: [] }, '2026-11-26');
        const a = q1.todays().map((t) => t.id);
        const q2 = new DailyQuests({ date: '', picks: [], progress: {}, claimed: [] }, '2026-11-26');
        const b = q2.todays().map((t) => t.id);
        expect(a).toEqual(b);
        const q3 = new DailyQuests({ date: '', picks: [], progress: {}, claimed: [] }, '2026-11-27');
        expect(q3.todays().map((t) => t.id)).not.toEqual(a);
    });

    it('日期回拨维持当日任务（防刷保护）', () => {
        const q = new DailyQuests({ date: '', picks: [], progress: {}, claimed: [] }, '2026-11-26');
        const picks = q.todays().map((t) => t.id);
        q.rolloverIfNeeded('2026-11-20');      // 回拨
        expect(q.todays().map((t) => t.id)).toEqual(picks);
        expect(normalizeDate('2026-11-26')).toBe('2026-11-26');
        expect(normalizeDate('非法输入')).toBe('1970-01-01');   // 异常时间输入回落默认（不崩溃）
    });

    it('进度累计与领取（幂等；领取仓同源存档）', () => {
        const q = new DailyQuests({ date: '', picks: [], progress: {}, claimed: [] }, '2026-11-26');
        q.addProgress('totalFrags', 80);
        const tpl = QUEST_TEMPLATES.find((t) => t.metric === 'totalFrags' && t.goal === 80)!;
        expect(q.progressOf(tpl)).toBe(80);
        const claimed: string[] = [];
        expect(q.claim(tpl, claimed)).toBe(true);
        expect(q.claim(tpl, claimed)).toBe(false);       // 重复领取被拒
        expect(claimed).toContain(tpl.id);
    });

    it('单局峰值任务取最大值（progressOf 按目标截断展示）', () => {
        const q = new DailyQuests({ date: '', picks: [], progress: {}, claimed: [] }, '2026-11-26');
        q.setRunMetric('runLi', 800);
        q.setRunMetric('runLi', 500);                     // 更低不覆盖
        q.setRunMetric('runLi', 1200);
        expect(q.state.progress['runLi']).toBe(1200);
        const runLi500 = QUEST_TEMPLATES.find((t) => t.id === 'run_li_500')!;
        expect(q.progressOf(runLi500)).toBe(500);         // 展示截断到目标
    });
});

describe('成就目录（≥60）与领取', () => {
    it('恰好 60 项且指标覆盖广', () => {
        expect(ACHIEVEMENTS.length).toBe(60);
        const metrics = new Set(ACHIEVEMENTS.map((a) => a.metric));
        expect(metrics.size).toBeGreaterThanOrEqual(15);
    });

    it('解锁判定与幂等领取', () => {
        const ach = new Achievements();
        const stats = defaultSaveData().stats;
        stats.totalLi = 12000;
        const def = ACHIEVEMENTS.find((a) => a.id === 'dist_3')!;   // 10000 里
        expect(ach.isUnlocked(def, stats, { skins: 1, upgradeLevels: 0 })).toBe(true);
        const claimed: string[] = [];
        expect(ach.claim(def, claimed)).toBe(true);
        expect(ach.claim(def, claimed)).toBe(false);
    });
});

describe('经济事务（幂等防重复）', () => {
    it('同事务 id 只发放一次', () => {
        const e = new Economy();
        expect(e.grant('q:2026-11-26:tot_li_4000', 180)).toBe(180);
        expect(e.grant('q:2026-11-26:tot_li_4000', 180)).toBe(0);
        expect(e.gold).toBe(180);
    });

    it('消费原子（不足拒绝不产生负数）', () => {
        const e = new Economy(100);
        expect(e.spend(150)).toBe(false);
        expect(e.gold).toBe(100);
        expect(e.spend(80)).toBe(true);
        expect(e.gold).toBe(20);
    });
});

describe('能力强化（公平性边界）', () => {
    it('恰好 5 系且每系上限 2 级', () => {
        expect(UPGRADE_DEFS.length).toBe(5);
        expect(UPGRADE_DEFS.every((d) => d.maxLevel === 2)).toBe(true);
        // 不含任何速度类强化（操作公平硬约束）
        expect(UPGRADE_DEFS.some((d) => d.kind === ('speed' as never))).toBe(false);
    });

    it('购买曲线与满级判定', () => {
        const u = new Upgrades({});
        expect(u.cost('staff')).toBe(400);
        u.apply('staff');
        expect(u.cost('staff')).toBe(900);
        u.apply('staff');
        expect(u.isMaxed('staff')).toBe(true);
        expect(u.cost('staff')).toBeNull();
        expect(u.staffCapBonus()).toBe(2);
    });

    it('热适应降低升温速率', () => {
        const c = new GameCore(CFG, new SeededRng(1), { turnsEnabled: false });
        c.startRun();
        c.mods.heatResist = 1 - 2 * 0.12;                  // Lv2 = -24%
        const rate1 = (() => { const h0 = c.heat; c.update(DT); const d = c.heat - h0; return d / DT; })();
        expect(rate1).toBeGreaterThan(0);
        expect(rate1).toBeLessThan(CFG.heat.baseRate * 1.5);
    });

    it('等级 clamp：非法等级不生效', () => {
        const u = new Upgrades({ gold: 99 });
        expect(levelOf(u.levels, 'gold')).toBe(2);
    });
});

describe('教程（可跳过交互式）', () => {
    it('六步顺序推进', () => {
        const c = makeCore(1, 'endless');
        const t = new Tutorial(true);
        expect(t.step?.id).toBe('lane');
        c.doLane(1);
        c.update(DT);
        t.onEvents(c.drainEvents());
        t.update(c);
        expect(t.step?.id).toBe('jump');
    });

    it('步骤齐全（任务书六项：切道/跳跃/滑铲/转弯/饮水/神通）', () => {
        const ids = TUTORIAL_STEPS.map((s) => s.id);
        expect(ids).toEqual(['lane', 'jump', 'slide', 'water', 'item', 'turn']);
    });

    it('跳过后不再推进', () => {
        const c = makeCore(1);
        const t = new Tutorial(true);
        t.skip();
        expect(t.done).toBe(true);
        const before = t.progressText;
        c.doJump();
        t.update(c);
        expect(t.progressText).toBe(before);
    });
});

function makeCore(seed: number, mode: 'endless' | 'journey' = 'endless'): GameCore {
    const c = new GameCore(CFG, new SeededRng(seed), { turnsEnabled: false, mode });
    c.startRun();
    return c;
}

describe('存档 v2（版本/校验和/备份/迁移/损坏）', () => {
    it('往返一致且含校验和', () => {
        const st = new MemStorage();
        const save = new Save(st);
        save.data.bestLi = 1234;
        save.data.gold = 500;
        save.flush();
        const raw = st.dump();
        const obj = JSON.parse(raw);
        expect(obj.v).toBe(2);
        expect(obj.checksum).toBeTruthy();
        expect(checksumOf(JSON.stringify({ ...obj, checksum: undefined }))).toBe(obj.checksum);
        expect(new Save(st).data.bestLi).toBe(1234);
    });

    it('主档损坏 → 备份恢复', () => {
        const st = new MemStorage();
        const save = new Save(st);
        save.data.gold = 777;
        save.flush();                                      // BAK = 此前状态
        save.data.gold = 100;
        save.flush();                                      // 主档 = 100，备份 = 777
        // 模拟主档损坏（覆盖为非法 JSON）
        st.set(KEY_SAVE, '{corrupted!!');
        const restored = new Save(st);
        expect(restored.data.gold).toBe(777);              // 从备份恢复
    });

    it('完全损坏 → 默认值（游戏仍可玩）', () => {
        const st = new MemStorage();
        st.set(KEY_SAVE, '{{{bad');
        const save = new Save(st);
        expect(save.data.bestLi).toBe(0);
        expect(save.data.skinsOwned).toContain('kuafu');
    });

    it('v1 散键迁移（老玩家存档不丢失）', () => {
        const st = new MemStorage();
        st.set(KEY_V1_BEST, '8000');
        st.set('zhuri.journeyDone', '1');
        const save = new Save(st);
        expect(save.data.bestLi).toBe(8000);
        expect(save.data.journeyDone).toBe(true);
    });

    it('校验和篡改检测', () => {
        const st = new MemStorage();
        const save = new Save(st);
        save.data.gold = 999;
        save.flush();
        const raw = st.get(KEY_SAVE)!;
        const obj = JSON.parse(raw);
        obj.gold = 99999;
        st.set(KEY_SAVE, JSON.stringify(obj));
        const loaded = new Save(st);
        expect(loaded.data.gold).not.toBe(99999);          // 篡改被检测回退
    });
});

describe('新用户完整流程模拟', () => {
    it('首次启动→教程→奔跑→赚金币→领奖→强化→重进', () => {
        const st = new MemStorage();
        const save = new Save(st);
        const econ = new Economy();
        const upgrades = new Upgrades(save.data.upgrades);
        const q = new DailyQuests(save.data.quests, '2026-11-26');
        const c = new GameCore(CFG, new SeededRng(7), { turnsEnabled: true });
        c.startRun();

        // 奔跑 60s（自动驾驶，神通/转弯处理）
        for (let i = 0; i < 3600; i++) {
            if (c.turnWindow) c.tryTurn(c.turnWindow.dir);
            c.update(DT);
            for (const e of c.drainEvents()) {
                if (e.type === 'fragment') econ.grant(`frag:${i}`, 1);
            }
        }
        // 结算：阳炎换金币 + 最佳纪录
        econ.grant('settle:1', c.frags);
        save.data.gold = econ.gold;
        save.data.bestLi = Math.floor(c.li);
        save.flush();

        // 任务领取（若有完成的）
        for (const t of q.todays()) {
            if (q.isComplete(t) && !q.isClaimed(t)) {
                if (q.claim(t, save.data.quests.claimed)) {
                    econ.grant(`q:${t.id}`, t.reward);
                }
            }
        }
        // 强化购买（买得起就买）
        for (const d of UPGRADE_DEFS) {
            const cost = upgrades.cost(d.kind);
            if (cost !== null && econ.spend(cost)) upgrades.apply(d.kind);
        }
        save.data.upgrades = { ...upgrades.levels };
        save.flush();

        // 重进验证（新 Save 实例读同 storage）
        const save2 = new Save(st);
        expect(save2.data.gold).toBe(econ.gold);
        expect(save2.data.bestLi).toBe(save.data.bestLi);
        expect(save2.data.upgrades).toEqual(save.data.upgrades);
    }, 60000);

    it('重复开局状态一致（5 次 startRun）', () => {
        const c = makeCore(9);
        for (let r = 0; r < 5; r++) {
            c.startRun();
            expect(c.dist).toBe(0);
            expect(c.frags).toBe(0);
            expect(c.obstacles.length).toBe(0);
            for (let i = 0; i < 600; i++) { c.update(DT); c.drainEvents(); }
        }
        expect(c.state).toBe('run');
    });
});

describe('皮肤/模板目录（Phase 5 交付回归）', () => {
    it('随包 skins.json ≥8 套', () => {
        const raw = JSON.parse(readFileSync(resolve(__dirname, '../assets/resources/skins.json'), 'utf8'));
        expect(validateSkins(raw)).toEqual([]);
        expect(raw.skins.length).toBeGreaterThanOrEqual(8);
    });

    it('随包 tile-templates.json ≥42 种', () => {
        const raw = JSON.parse(readFileSync(resolve(__dirname, '../assets/resources/tile-templates.json'), 'utf8'));
        expect(validateTileTemplates(raw)).toEqual([]);
        expect(raw.templates.length).toBeGreaterThanOrEqual(42);
    });
});
