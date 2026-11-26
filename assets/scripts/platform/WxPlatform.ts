/**
 * WxPlatform —— 微信小游戏平台实现（Phase 7）。
 * 所有能力基于 wx 官方 API；不可用时返回明确状态（不伪造成功）。
 * 广告位 ID 由配置注入；空 ID 一律返回 supported=false —— 不编造正式广告位。
 */
import { CapabilityResult, IInterstitialAdapter, IPlatform, IRewardedAdapter, ScreenInfo } from './IPlatform';

interface WxRewarded {
    load(): Promise<void>;
    show(): Promise<void>;
    onClose(cb: (res: { isEnded?: boolean }) => void): void;
    offClose(cb: (res: { isEnded?: boolean }) => void): void;
}
interface WxInterstitial { load(): Promise<void>; show(): Promise<void>; }
interface WxApi {
    getStorageSync(k: string): string;
    setStorageSync(k: string, v: string): void;
    onHide(cb: () => void): void;
    onShow(cb: () => void): void;
    offHide?(cb: () => void): void;
    offShow?(cb: () => void): void;
    getWindowInfo?(): { screenWidth: number; screenHeight: number; pixelRatio: number; safeArea?: { top: number; bottom: number } };
    getMenuButtonBoundingClientRect?(): { right: number; bottom: number };
    shareAppMessage?(o: { title: string; query: string }): void;
    createRewardedVideoAd?(o: { adUnitId: string }): WxRewarded;
    createInterstitialAd?(o: { adUnitId: string }): WxInterstitial;
    resumeBackgroundAudio?(): Promise<void>;
}

declare const wx: WxApi | undefined;

function hasWx(): boolean {
    return typeof wx !== 'undefined';
}

const noAd = (reason: string) => ({
    supported: false as const,
    unsupportedReason: reason,
    load: async () => false,
    show: async () => { throw new Error(reason); },
});

export class WxPlatform implements IPlatform {
    readonly name = 'wechat' as const;
    readonly isWechat = true;

    storage = {
        get: (key: string) => {
            if (!hasWx()) return null;
            try { return (wx as WxApi).getStorageSync(key) || null; } catch { return null; }
        },
        set: (key: string, value: string) => {
            if (!hasWx()) return;
            try { (wx as WxApi).setStorageSync(key, value); } catch { /* 存储配额满：不崩溃，游戏继续 */ }
        },
    };

    lifecycle(handlers: { onHide(): void; onShow(): void }): CapabilityResult<void> {
        if (!hasWx()) return { supported: false, reason: 'wx 未定义' };
        const api = wx!;
        api.onHide(handlers.onHide);
        api.onShow(handlers.onShow);
        return { supported: true };
    }

    screen(): ScreenInfo {
        if (!hasWx()) return { width: 720, height: 1280, safeTop: 0, safeBottom: 0, capsuleRight: 0, pixelRatio: 1 };
        const info = (wx as WxApi).getWindowInfo?.() ?? { screenWidth: 720, screenHeight: 1280, pixelRatio: 1 };
        const safe = info.safeArea;
        const cap = (wx as WxApi).getMenuButtonBoundingClientRect?.();
        return {
            width: info.screenWidth, height: info.screenHeight, pixelRatio: info.pixelRatio || 1,
            safeTop: safe?.top ?? 0,
            safeBottom: safe ? info.screenHeight - safe.bottom : 0,
            capsuleRight: cap?.right ?? 0,
        };
    }

    share(title: string, query: string): CapabilityResult<void> {
        const api = hasWx() ? wx! : null;
        if (!api || typeof api.shareAppMessage !== 'function') {
            return { supported: false, reason: 'wx.shareAppMessage 不可用' };
        }
        try { api.shareAppMessage({ title, query }); return { supported: true }; }
        catch (e) { return { supported: false, reason: String(e) }; }
    }

    resumeAudio(): CapabilityResult<void> {
        const api = hasWx() ? wx! : null;
        if (!api || typeof api.resumeBackgroundAudio !== 'function') {
            return { supported: false, reason: 'wx.resumeBackgroundAudio 不可用（引擎 AudioSource 兜底）' };
        }
        api.resumeBackgroundAudio().catch(() => { /* 音频恢复失败不阻断游戏 */ });
        return { supported: true, reason: '已发起恢复（异步）' };
    }

    rewardedAd(adUnitId: string): IRewardedAdapter {
        if (!hasWx() || !adUnitId || typeof (wx as WxApi).createRewardedVideoAd !== 'function') {
            return noAd('激励视频不可用：广告位 ID 未配置或 (wx as WxApi).createRewardedVideoAd 缺失');
        }
        const api = wx!;
        const ad = api.createRewardedVideoAd!({ adUnitId });
        return {
            supported: true,
            load: () => ad.load().then(() => true),
            show: (onClose: (isEnded: boolean) => void) => {
                const cb = (res: { isEnded?: boolean }) => {
                    ad.offClose(cb);
                    // ★ 官方判据：仅 isEnded 为 true 才视为完整观看（任务书硬约束）
                    onClose(res?.isEnded === true);
                };
                ad.onClose(cb);
                return ad.show().catch(() => ad.load().then(() => ad.show()));
            },
        };
    }

    interstitialAd(adUnitId: string): IInterstitialAdapter {
        if (!hasWx() || !adUnitId || typeof (wx as WxApi).createInterstitialAd !== 'function') {
            return noAd('插屏广告不可用：广告位 ID 未配置或 (wx as WxApi).createInterstitialAd 缺失');
        }
        const api = wx!;
        const ad = api.createInterstitialAd!({ adUnitId });
        return {
            supported: true,
            load: () => ad.load().then(() => true),
            show: () => ad.show().then(() => true),
        };
    }
}
