/**
 * IPlatform —— 平台服务抽象（Phase 7）。
 * 浏览器与微信小游戏各自实现；不支持的能力返回明确状态（supported=false + reason），
 * 禁止伪造成功。所有广告位 ID 由独立配置注入，代码中不含任何正式/测试广告位常量。
 */
export type CapabilityResult<T> = {
    supported: boolean;
    value?: T;
    reason?: string;
    /** 注册型能力（生命周期）必须提供注销入口，防止场景重建后回调泄漏 */
    dispose?: () => void;
};

export interface ScreenInfo {
    width: number;
    height: number;
    safeTop: number;
    safeBottom: number;
    capsuleRight: number;      // 微信胶囊按钮右边界（浏览器为 0）
    pixelRatio: number;
}

export interface LifecycleHandlers {
    onHide(): void;
    onShow(): void;
}

/** 激励视频广告适配器（平台实现） */
export interface IRewardedAdapter {
    readonly supported: boolean;
    readonly unsupportedReason?: string;
    /** 加载广告；resolve=true 表示可展示 */
    load(): Promise<boolean>;
    /** 展示；onClose 回调 res.isEnded 为微信官方完整观看判据 */
    show(onClose: (isEnded: boolean) => void): Promise<void>;
}

/** 插屏广告适配器 */
export interface IInterstitialAdapter {
    readonly supported: boolean;
    readonly unsupportedReason?: string;
    load(): Promise<boolean>;
    show(): Promise<boolean>;
}

export interface IPlatform {
    readonly name: 'browser' | 'wechat';
    readonly isWechat: boolean;
    storage: {
        get(key: string): string | null;
        set(key: string, value: string): void;
    };
    /** 生命周期（不支持时返回 supported=false） */
    lifecycle(handlers: LifecycleHandlers): CapabilityResult<void>;
    /** 屏幕/安全区信息（始终可给出浏览器兜底值） */
    screen(): ScreenInfo;
    /** 分享（不支持时明确返回 supported=false） */
    share(title: string, query: string): CapabilityResult<void>;
    /** 音频恢复（切后台回来后的平台特定恢复；不支持时明确返回） */
    resumeAudio(): CapabilityResult<void>;
    /** 广告适配器工厂：adUnitId 为空时返回 supported=false（明确失败） */
    rewardedAd(adUnitId: string): IRewardedAdapter;
    interstitialAd(adUnitId: string): IInterstitialAdapter;
}

/** 不支持能力的统一错误 */
export class UnsupportedError extends Error {
    constructor(cap: string, reason: string) {
        super(`平台不支持 ${cap}: ${reason}`);
        this.name = 'UnsupportedError';
    }
}
