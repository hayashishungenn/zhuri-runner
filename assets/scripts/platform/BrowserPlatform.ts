/**
 * BrowserPlatform —— 浏览器/编辑器测试环境平台实现。
 * 分享/微信广告明确返回 supported=false（不伪造成功）；广告模拟由 platform/mock 独立提供，
 * 且仅在非微信环境启用（正式包不会通过模拟广告发奖）。
 */
import { CapabilityResult, IInterstitialAdapter, IPlatform, IRewardedAdapter, ScreenInfo } from './IPlatform';

const unsupported = (cap: string, reason: string): CapabilityResult<void> =>
    ({ supported: false, reason: `${cap} 仅在微信小游戏环境可用：${reason}` });

/** 明确不支持的广告适配器（浏览器正式路径：不发奖） */
const unsupportedAd = (reason: string) => ({
    supported: false,
    unsupportedReason: reason,
    load: async () => false,
    show: async () => { throw new Error(reason); },
});

export class BrowserPlatform implements IPlatform {
    readonly name = 'browser' as const;
    readonly isWechat = false;
    private mem = new Map<string, string>();

    storage = {
        get: (key: string) => {
            try {
                const v = globalThis.localStorage?.getItem(key);
                return v ?? this.mem.get(key) ?? null;
            } catch {
                return this.mem.get(key) ?? null;       // 隐私模式降级到内存存储
            }
        },
        set: (key: string, value: string) => {
            this.mem.set(key, value);
            try { globalThis.localStorage?.setItem(key, value); } catch { /* 内存存储已生效 */ }
        },
    };

    lifecycle(): CapabilityResult<void> {
        return { supported: false, reason: '浏览器使用引擎 Game.EVENT_HIDE 兜底（由 Game 装配）' };
    }

    screen(): ScreenInfo {
        if (typeof window !== 'undefined') {
            return {
                width: window.innerWidth, height: window.innerHeight,
                safeTop: 0, safeBottom: 0, capsuleRight: 0,
                pixelRatio: window.devicePixelRatio || 1,
            };
        }
        return { width: 720, height: 1280, safeTop: 0, safeBottom: 0, capsuleRight: 0, pixelRatio: 1 };
    }

    share(_title: string, _query: string): CapabilityResult<void> {
        return unsupported('分享', '浏览器无 wx.shareAppMessage');
    }

    resumeAudio(): CapabilityResult<void> {
        return { supported: true };                    // 浏览器 AudioSource 自动恢复
    }

    rewardedAd(adUnitId: string): IRewardedAdapter {
        return unsupportedAd(`浏览器环境无激励视频（adUnitId=${adUnitId || '空'}）`);
    }

    interstitialAd(adUnitId: string): IInterstitialAdapter {
        return unsupportedAd(`浏览器环境无插屏广告（adUnitId=${adUnitId || '空'}）`);
    }
}
