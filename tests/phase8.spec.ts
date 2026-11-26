/**
 * Phase 8 独立审查修复回归：跨局事务、存档二次损坏、异步回调守卫、平台判据、
 * 单帧跨阈值、强化注入、频控持久化。全部为零 cc 依赖的确定性测试。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunLedger } from '../assets/scripts/core/RunLedger';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { Economy } from '../assets/scripts/core/Economy';
import { PlayerStats } from '../assets/scripts/core/PlayerStats';
import { DailyQuests, QUEST_TEMPLATES } from '../assets/scripts/core/Quests';
import { Upgrades } from '../assets/scripts/core/Upgrades';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';
import {
    Save, Storage, KEY_SAVE, KEY_SAVE_BAK, parseSave, defaultSaveData,
} from '../assets/scripts/platform/Save';
import { AdService, AdServiceCfg } from '../assets/scripts/platform/AdService';
import { BrowserPlatform } from '../assets/scripts/platform/BrowserPlatform';
import { WxPlatform } from '../assets/scripts/platform/WxPlatform';
import { createPlatform, detectWechat } from '../assets/scripts/platform/PlatformFactory';
import { MockRewardedAdapter, MockInterstitialAdapter } from '../assets/scripts/platform/mock/MockAdAdapter';
import { mergeAdStats, defaultAdStats } from '../assets/scripts/core/AdStats';
import { ACHIEVEMENTS, Achievements } from '../assets/scripts/core/Achievements';

const DT = 1 / 60;

class MemStorage implements Storage {
    private m = new Map<string, string>();
    get(k: string): string | null { return this.m.get(k) ?? null; }
    set(k: string, v: string): void { this.m.set(k, v); }
}

function core(seed = 1): GameCore {
    return new GameCore(CFG, new SeededRng(seed));
}

const AD_CFG: AdServiceCfg = {
    mode: 'mock', timeoutMs: 40,
    adUnitIds: { revive: 'u-revive' },
    interstitialUnitId: 'u-inter',
    interstitial: { enabled: true, firstRunProtection: 1, cooldownMs: 1000, maxPerDay: 2 },
};

function makeAd(outcome: 'success' | 'timeout' = 'success', cfg?: Partial<AdServiceCfg>) {
    const rewarded = new MockRewardedAdapter();
    rewarded.outcome = outcome;
    const ad = new AdService(new BrowserPlatform(), { ...AD_CFG, ...cfg }, undefined, rewarded, new MockInterstitialAdapter());
    return { ad, rewarded };
}

describe('跨局事务与教程参数（Phase 8）', () => {
    it('教程参数在结束/下一局还原，不污染正式局', () => {
        const ledger = new RunLedger();
        const spawn = { rowInterval: 8 };
        const map = { turnGapMin: 30, turnGapMax: 180 };
        ledger.beginRun(spawn, map, true);
        expect(spawn.rowInterval).toBe(16);
        expect(map.turnGapMax).toBe(60);
        ledger.endTutorial(spawn, map);
        expect(spawn.rowInterval).toBe(8);
        expect(map.turnGapMax).toBe(180);
        // 连续两局教程不会把已覆写值当作"原值"备份
        ledger.beginRun(spawn, map, true);
        ledger.beginRun(spawn, map, false);
        expect(spawn.rowInterval).toBe(8);
        expect(map.turnGapMax).toBe(180);
    });

    it('跨局金币事务 id 唯一，同局同碎片不重复发放', () => {
        const ledger = new RunLedger();
        const spawn = { rowInterval: 8 };
        const map = { turnGapMin: 30, turnGapMax: 180 };
        const seed1 = ledger.beginRun(spawn, map, false);
        expect(ledger.fragmentGrant(5, 1)).toEqual({ txId: `frag:${seed1}:5`, amount: 5 });
        expect(ledger.fragmentGrant(5, 1)).toBeNull();
        const seed2 = ledger.beginRun(spawn, map, false);
        expect(seed2).not.toBe(seed1);
        expect(ledger.fragmentGrant(5, 1)).toEqual({ txId: `frag:${seed2}:5`, amount: 5 });
    });

    it('结算去重：同一局只结算一次', () => {
        const ledger = new RunLedger();
        const seed = ledger.beginRun({ rowInterval: 8 }, { turnGapMin: 1, turnGapMax: 2 }, false);
        expect(ledger.claimSettlement(seed)).toBe(true);
        expect(ledger.claimSettlement(seed)).toBe(false);
        expect(ledger.claimSettlement(seed + 1)).toBe(false);
    });

    it('异步复活回调在状态已变时不生效', () => {
        const c = core();
        c.startRun();
        expect(c.revive()).toBe(false);
        expect(c.reviveUsed).toBe(false);
        while (c.state === 'run') c.update(DT);      // 自然跑向死亡（无限直道由障碍触发）
        for (let i = 0; i < 600 && c.state !== 'dead'; i++) c.update(DT);
        if (c.state === 'dead') {
            expect(c.revive()).toBe(true);
            expect(c.revive()).toBe(false);
        }
    });
});

describe('存档与经济（Phase 8）', () => {
    it('主档二次损坏仍能从备份恢复，备份不被损坏档覆盖', () => {
        const st = new MemStorage();
        let s = new Save(st);
        s.data.gold = 777;
        s.flush();
        s.data.gold = 100;
        s.flush();
        st.set(KEY_SAVE, '{corrupted!!');
        s = new Save(st);
        expect(s.data.gold).toBe(777);
        expect(parseSave(st.get(KEY_SAVE_BAK))?.gold).toBe(777);
        st.set(KEY_SAVE, '{corrupted again!!');
        s = new Save(st);
        expect(s.data.gold).toBe(777);
    });

    it('事务日志跨会话防重复领取', () => {
        const st = new MemStorage();
        const s = new Save(st);
        const econ = new Economy(s.data.gold, s.data.txLog);
        expect(econ.grant('q:2026-11-26:tot_li_4000', 180)).toBe(180);
        s.data.gold = econ.gold;
        s.data.txLog = econ.exportTxLog();
        s.flush();
        const s2 = new Save(st);
        const econ2 = new Economy(s2.data.gold, s2.data.txLog);
        expect(econ2.grant('q:2026-11-26:tot_li_4000', 180)).toBe(0);
        expect(econ2.gold).toBe(180);
    });

    it('事务日志有界（512），不会随长局无限增长', () => {
        const e = new Economy();
        for (let i = 0; i < 700; i++) e.grant(`frag:${i}`, 1);
        expect(e.exportTxLog()).toHaveLength(512);
        expect(e.gold).toBe(700);
    });

    it('ads 频控状态纳入存档校验和与合并', () => {
        const d = defaultSaveData();
        d.ads.interstitial.shownToday = 2;
        d.ads.interstitial.date = '2026-11-26';
        const st = new MemStorage();
        const s = new Save(st);
        s.data = d;
        s.flush();
        const loaded = new Save(st);
        expect(loaded.data.ads.interstitial.shownToday).toBe(2);
        expect(parseSave(st.get(KEY_SAVE))?.ads.interstitial.shownToday).toBe(2);
        // 旧档缺 ads 段时补齐默认而非崩溃
        expect(mergeAdStats(null).interstitial.completedRuns).toBe(0);
        expect(mergeAdStats({ ...defaultAdStats(), interstitial: undefined } as never).interstitial.shownToday).toBe(0);
    });
});

describe('单帧跨阈值与成长注入（Phase 8）', () => {
    it('单帧跨多个里程碑逐次补发事件', () => {
        const c = core();
        c.startRun();
        c.dist = 2000;                       // li=6000，跨 6 个里程碑
        c.update(DT);
        const ms = c.drainEvents().filter((e) => e.type === 'milestone').map((e) => e.n);
        expect(ms).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
        expect(c.milestone).toBe(7000);
    });

    it('单帧跨全部征途阶段直接通关并补发 stage', () => {
        const c = new GameCore(CFG, new SeededRng(3), { mode: 'journey' });
        c.startRun();
        c.dist = CFG.journey.stages[CFG.journey.stages.length - 1].goalLi / CFG.milestone.liScale + 1;
        c.update(DT);
        const events = c.drainEvents();
        expect(events.filter((e) => e.type === 'stage')).toHaveLength(CFG.journey.stages.length);
        expect(events.some((e) => e.type === 'journeyDone')).toBe(true);
        expect(c.state).toBe('ended');
    });

    it('五系强化全部注入核心效果（神杖上限/磁吸/水/热/金币）', () => {
        const c = core();
        const up = new Upgrades({ staff: 2, water: 2, magnet: 2, heat: 2, gold: 2 });
        c.mods = {
            staffCapBonus: up.staffCapBonus(), waterReduceBonus: up.waterReduceBonus(),
            magnetBonus: up.magnetDurationBonus(), heatResist: up.heatResist(), goldMul: up.goldMul(),
        };
        expect(c.mods.staffCapBonus).toBe(2);
        expect(c.mods.magnetBonus).toBe(6);
        expect(c.mods.waterReduceBonus).toBe(20);
        expect(c.mods.heatResist).toBeCloseTo(0.76, 5);
        expect(c.mods.goldMul).toBeCloseTo(1.3, 5);
        // 高温下降速度确实弱于无强化
        const plain = core();
        c.startRun(); plain.startRun();
        for (let i = 0; i < 120; i++) { c.update(DT); plain.update(DT); }
        expect(c.heat).toBeLessThan(plain.heat);
    });

    it('任务进度新局清零，领取不再重复写入 claimed', () => {
        const q = new DailyQuests(defaultSaveData().quests, '2026-11-26');
        q.setRunMetric('runLi', 500);
        q.resetRunMetrics();
        expect(q.state.progress.runLi).toBeUndefined();
        const tpl = QUEST_TEMPLATES[0];
        const store: string[] = [];
        expect(q.claim(tpl, store)).toBe(true);
        expect(store).toEqual([tpl.id]);
        expect(q.claim(tpl, store)).toBe(false);
    });

    it('征途通关计入 journeys 成就指标', () => {
        const st = defaultSaveData().stats;
        const ps = new PlayerStats(st);
        ps.onRunSettle(1, 0, 0, 'ended', 3, 3);
        expect(st.itemUses.journey).toBe(1);
        const ach = ACHIEVEMENTS.find((a) => a.metric === 'journeys')!;
        expect(new Achievements().isUnlocked(ach, st, { skins: 1, upgradeLevels: 0 })).toBe(true);
    });
});

describe('广告平台与频控（Phase 8）', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('超时后迟到的 isEnded=true 仍不发奖', async () => {
        const { ad, rewarded } = makeAd('timeout');
        let rewards = 0;
        const r = await ad.requestReward('revive', () => rewards++);
        expect(r.reason).toBe('timeout');
        rewarded.fireClose(true);
        expect(rewards).toBe(0);
        expect(ad.stats.data.totals.rewards).toBe(0);
    });

    it('切后台冻结超时，回前台按剩余时间继续', async () => {
        vi.useFakeTimers();
        const { ad } = makeAd('timeout', { timeoutMs: 1000 });
        const p = ad.requestReward('revive', () => {});
        await vi.advanceTimersByTimeAsync(1);
        expect(ad.state).toBe('showing');
        ad.onHide();
        await vi.advanceTimersByTimeAsync(5000);
        expect(ad.state).toBe('showing');
        ad.onShow();
        await vi.advanceTimersByTimeAsync(500);
        expect(ad.state).toBe('showing');
        await vi.advanceTimersByTimeAsync(600);
        expect((await p).reason).toBe('timeout');
    });

    it('插屏频控跨会话持久化（每日上限/首局保护）', () => {
        const saved = defaultAdStats();
        saved.interstitial.completedRuns = 3;
        saved.interstitial.shownToday = 2;
        saved.interstitial.date = new Date().toISOString().slice(0, 10);
        const a = new AdService(new BrowserPlatform(), AD_CFG, saved, undefined, new MockInterstitialAdapter());
        expect(a.completedRuns).toBe(3);
        expect(a.interstitialShownToday).toBe(2);
        expect(a.maybeShowInterstitial()).toBe(false);           // 达每日上限
        const b = new AdService(new BrowserPlatform(), AD_CFG, defaultAdStats(), undefined, new MockInterstitialAdapter());
        b.loadStats(saved);
        expect(b.completedRuns).toBe(3);
    });

    it('WxPlatform 严格 isEnded 判据并在回调后注销监听', async () => {
        const cbs: Array<(r: { isEnded?: boolean }) => void> = [];
        const fakeAd = {
            load: vi.fn(async () => true),
            show: vi.fn(async () => {}),
            onClose: vi.fn((cb) => cbs.push(cb)),
            offClose: vi.fn((cb) => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); }),
        };
        vi.stubGlobal('wx', { createRewardedVideoAd: () => fakeAd });
        const p = new WxPlatform();
        expect(p.rewardedAd('').supported).toBe(false);
        const got: boolean[] = [];
        await p.rewardedAd('unit').show((v) => got.push(v));
        expect(cbs).toHaveLength(1);
        cbs[0]({ isEnded: false });
        await p.rewardedAd('unit').show((v) => got.push(v));
        cbs[0]({});
        await p.rewardedAd('unit').show((v) => got.push(v));
        cbs[0]({ isEnded: true });
        expect(got).toEqual([false, false, true]);
        expect(fakeAd.offClose).toHaveBeenCalledTimes(3);
    });

    it('WxPlatform show 失败不重试，并注销 onClose', async () => {
        const cbs: Array<(r: { isEnded?: boolean }) => void> = [];
        const fakeAd = {
            load: vi.fn(async () => true),
            show: vi.fn(async () => { throw new Error('showFailed'); }),
            onClose: vi.fn((cb) => cbs.push(cb)),
            offClose: vi.fn((cb) => { const i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); }),
        };
        vi.stubGlobal('wx', { createRewardedVideoAd: () => fakeAd });
        const p = new WxPlatform();
        await expect(p.rewardedAd('unit').show(() => {})).rejects.toThrow('showFailed');
        expect(fakeAd.load).not.toHaveBeenCalled();   // 适配器内不重试（重试由 AdService 显式控制）
        expect(cbs).toHaveLength(0);
    });

    it('平台工厂按 wx 存在性选择实现，生命周期注册可注销', () => {
        const hide: Array<() => void> = [];
        const show: Array<() => void> = [];
        const offHide = vi.fn((cb: () => void) => { const i = hide.indexOf(cb); if (i >= 0) hide.splice(i, 1); });
        const offShow = vi.fn((cb: () => void) => { const i = show.indexOf(cb); if (i >= 0) show.splice(i, 1); });
        vi.stubGlobal('wx', {
            onHide: (cb: () => void) => hide.push(cb),
            onShow: (cb: () => void) => show.push(cb),
            offHide, offShow,
        });
        expect(detectWechat()).toBe(true);
        const p = createPlatform();
        expect(p.isWechat).toBe(true);
        const r = p.lifecycle({ onHide() {}, onShow() {} });
        expect(r.supported).toBe(true);
        expect(hide).toHaveLength(1);
        r.dispose?.();
        expect(offHide).toHaveBeenCalledTimes(1);
        expect(offShow).toHaveBeenCalledTimes(1);
    });
});
