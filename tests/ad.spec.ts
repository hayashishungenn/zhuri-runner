/**
 * Phase 7 广告测试：状态机成功/取消/失败/超时/重复回调、事务幂等、
 * 平台隔离（微信端 mock 不发奖）、插屏频控、失败不阻断游戏。
 */
import { describe, it, expect } from 'vitest';
import { AdService, AdServiceCfg } from '../assets/scripts/platform/AdService';
import { BrowserPlatform } from '../assets/scripts/platform/BrowserPlatform';
import { IPlatform } from '../assets/scripts/platform/IPlatform';
import { MockRewardedAdapter, MockInterstitialAdapter, MockOutcome } from '../assets/scripts/platform/mock/MockAdAdapter';

const BASE_CFG: AdServiceCfg = {
    mode: 'mock',
    timeoutMs: 60,
    adUnitIds: { revive: 'unit-revive', doubleCoins: 'unit-double' },
    interstitialUnitId: 'unit-inter',
    interstitial: { enabled: true, firstRunProtection: 1, cooldownMs: 10000, maxPerDay: 2 },
};

function makeService(outcome: MockOutcome = 'success', override?: Partial<AdServiceCfg>, platform?: IPlatform) {
    const rewarded = new MockRewardedAdapter();
    rewarded.outcome = outcome;
    const interstitial = new MockInterstitialAdapter();
    const ad = new AdService(platform ?? new BrowserPlatform(), { ...BASE_CFG, ...override }, undefined, rewarded, interstitial);
    return { ad, rewarded, interstitial };
}

describe('激励视频状态机', () => {
    it('成功观看（isEnded=true）发奖且事务仅一次', async () => {
        const { ad } = makeService('success');
        let rewards = 0;
        const r = await ad.requestReward('revive', () => rewards++);
        expect(r.rewarded).toBe(true);
        expect(rewards).toBe(1);
        expect(ad.state).toBe('rewarded');
        expect(ad.stats.data.totals.completes).toBe(1);
        expect(ad.stats.data.totals.rewards).toBe(1);
    });

    it('用户取消（isEnded=false）不发奖、不阻断', async () => {
        const { ad } = makeService('cancel');
        let rewards = 0;
        const r = await ad.requestReward('revive', () => rewards++);
        expect(r.rewarded).toBe(false);
        expect(r.reason).toBe('notEnded');
        expect(rewards).toBe(0);
        expect(ad.state).toBe('failed');
        expect(ad.lastFailReason).toBe('notEnded');
    });

    it('加载/展示失败 → 明确失败原因，不发奖', async () => {
        const { ad } = makeService('fail');
        const r = await ad.requestReward('revive', () => { throw new Error('不应发奖'); });
        expect(r.rewarded).toBe(false);
        expect(['showFailed', 'loadFailed', 'noFill']).toContain(r.reason);
        expect(ad.stats.data.totals.fails).toBeGreaterThan(0);
    });

    it('超时守护（无回调）→ timeout 失败', async () => {
        const { ad } = makeService('timeout');
        const r = await ad.requestReward('revive', () => { throw new Error('不应发奖'); });
        expect(r.rewarded).toBe(false);
        expect(r.reason).toBe('timeout');
    });

    it('重复回调只结算一次', async () => {
        const { ad } = makeService('duplicate');
        let rewards = 0;
        const r = await ad.requestReward('revive', () => rewards++);
        expect(r.rewarded).toBe(true);
        expect(rewards).toBe(1);
        expect(ad.stats.data.events.filter((e) => e.detail === 'duplicate').length).toBeGreaterThan(0);
    });

    it('并发请求被拒（duplicate）', async () => {
        const { ad, rewarded } = makeService('timeout');
        const p1 = ad.requestReward('revive', () => {});
        // 第二个请求在 inFlight 期间应被拒
        const p2 = ad.requestReward('doubleCoins', () => {});
        const [, r2] = await Promise.all([p1, p2]);
        expect(rewarded.showCalls).toBe(1);
        expect(r2.reason).toBe('duplicate');
    });
});

describe('广告场景与平台隔离', () => {
    it('广告位未配置 → 明确 noAdUnit（不伪造成功）', async () => {
        const { ad } = makeService('success', { adUnitIds: {} });
        const check = ad.canUse('revive');
        expect(check.ok).toBe(false);
        expect(check.reason).toBe('noAdUnit');
        const r = await ad.requestReward('revive', () => { throw new Error('不应发奖'); });
        expect(r.rewarded).toBe(false);
        expect(r.reason).toBe('noAdUnit');
    });

    it('微信环境 mock 模式 → 隔离不发奖（正式版禁止测试广告发奖）', async () => {
        const wxLike = Object.assign(Object.create(BrowserPlatform.prototype), {
            name: 'wechat', isWechat: true,
            storage: new BrowserPlatform().storage,
        }) as IPlatform;
        const { ad } = makeService('success', { mode: 'mock' }, wxLike);
        const check = ad.canUse('revive');
        expect(check.ok).toBe(false);
        expect(check.reason).toBe('unsupported');
        const r = await ad.requestReward('revive', () => { throw new Error('正式包禁止模拟广告发奖'); });
        expect(r.rewarded).toBe(false);
    });

    it('五个广告场景均可用独立广告位配置', () => {
        const { ad } = makeService('success', {
            adUnitIds: {
                revive: 'a', doubleCoins: 'b', dailyDouble: 'c', timedPower: 'd', skinTrial: 'e',
            },
        });
        for (const s of ['revive', 'doubleCoins', 'dailyDouble', 'timedPower', 'skinTrial'] as const) {
            expect(ad.canUse(s).ok).toBe(true);
        }
    });
});

describe('插屏频控（自然节点专属，不打断奔跑）', () => {
    it('总开关关闭 → 永不展示', () => {
        const { ad, interstitial } = makeService('success', { interstitial: { ...BASE_CFG.interstitial, enabled: false } });
        expect(ad.maybeShowInterstitial()).toBe(false);
        expect(interstitial.showCalls).toBe(0);
    });

    it('首局保护 + 冷却 + 每日上限', () => {
        const { ad } = makeService('success');
        expect(ad.maybeShowInterstitial()).toBe(false);     // 首局保护（completedRuns=0）
        ad.noteRunEnd();                                    // 第 1 局结束
        expect(ad.maybeShowInterstitial()).toBe(true);      // 第 2 局可展示
        expect(ad.maybeShowInterstitial()).toBe(false);     // 冷却中
        ad.lastInterstitialAt = 0;                          // 模拟冷却过期
        expect(ad.maybeShowInterstitial()).toBe(true);      // 第 2 次
        ad.lastInterstitialAt = 0;
        expect(ad.maybeShowInterstitial()).toBe(false);     // 达到每日上限 2
    });
});

describe('浏览器平台能力状态（不伪造成功）', () => {
    it('分享明确不支持', () => {
        const p = new BrowserPlatform();
        const s = p.share('标题', '');
        expect(s.supported).toBe(false);
        expect(s.reason).toBeTruthy();
    });

    it('浏览器广告不支持（未注入模拟适配器）', () => {
        const p = new BrowserPlatform();
        expect(p.rewardedAd('any').supported).toBe(false);
        expect(p.interstitialAd('any').supported).toBe(false);
    });

    it('存储可用（内存兜底）', () => {
        const p = new BrowserPlatform();
        p.storage.set('k', 'v');
        expect(p.storage.get('k')).toBe('v');
    });

    it('屏幕信息有兜底值', () => {
        const s = new BrowserPlatform().screen();
        expect(s.width).toBeGreaterThan(0);
        expect(s.height).toBeGreaterThan(0);
    });
});
