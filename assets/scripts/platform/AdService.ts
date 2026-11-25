/**
 * 平台层：激励视频广告抽象。
 * - MockAdService：开发/预览用倒计时模拟（与 P0 时序逐帧一致），编辑器与测试环境使用。
 * - WxAdService：微信真机 wx.createRewardedVideoAd 实现（P4 接入真实 adUnitId）。
 * 失败必须显式抛错（规范：不静默降级）。
 */
import { GameConfig } from '../config/GameConfigSchema';

export interface AdService {
    /** 广告展示中（模拟层为倒计时进行中） */
    readonly active: boolean;
    /** 模拟层剩余倒计时步数（wx 层无意义，恒 0） */
    readonly stepsLeft: number;
    /** 模拟层倒计时结束（显示 ✓ 阶段） */
    readonly done: boolean;
    /** 展示广告；看完并满足条件后回调 onReward（发奖） */
    show(onReward: () => void): void;
    /** 驱动模拟层时序；wx 层为空操作 */
    update(dtRaw: number): void;
}

/** 倒计时模拟：steps 次 × stepDuration → done（✓）→ 再一个 step 后发奖。与 P0 逐帧一致。 */
export class MockAdService implements AdService {
    private steps: number;
    private stepDuration: number;
    private timer = 0;
    private _stepsLeft = 0;
    private _done = false;
    private _active = false;
    private cb: (() => void) | null = null;

    constructor(cfg: GameConfig) {
        this.steps = cfg.ad.countdownSteps;
        this.stepDuration = cfg.ad.stepDuration;
    }

    get active(): boolean { return this._active; }
    get stepsLeft(): number { return this._stepsLeft; }
    get done(): boolean { return this._done; }

    show(onReward: () => void) {
        if (this._active) return;
        this.cb = onReward;
        this._active = true;
        this._stepsLeft = this.steps;
        this._done = false;
        this.timer = this.stepDuration;
    }

    update(dtRaw: number) {
        if (!this._active) return;
        this.timer -= dtRaw;
        if (this.timer > 0) return;
        if (this._done) {
            this._active = false;
            const cb = this.cb;
            this.cb = null;
            if (cb) cb();
        } else {
            this._stepsLeft--;
            this.timer = this.stepDuration;
            if (this._stepsLeft <= 0) { this._stepsLeft = 0; this._done = true; }
        }
    }
}

/** wx 激励视频最小类型（避免引入微信 d.ts 依赖） */
interface WxRewardedVideoAd {
    load(): Promise<void>;
    show(): Promise<void>;
    onClose(cb: (res: { isEnded?: boolean }) => void): void;
    offClose(cb: (res: { isEnded?: boolean }) => void): void;
}
interface WxApi {
    createRewardedVideoAd(params: { adUnitId: string }): WxRewardedVideoAd;
}
declare const wx: WxApi | undefined;

export class WxAdService implements AdService {
    private unitId: string;
    private ad: WxRewardedVideoAd | null = null;
    private cb: (() => void) | null = null;
    private closeHandler: ((res: { isEnded?: boolean }) => void) | null = null;

    constructor(unitId: string) {
        this.unitId = unitId;
    }

    get active(): boolean { return false; }
    get stepsLeft(): number { return 0; }
    get done(): boolean { return false; }

    show(onReward: () => void) {
        if (typeof wx === 'undefined') {
            throw new Error('ad.mode=wx 需要微信运行时（wx 未定义）；开发环境请使用 mock');
        }
        if (!this.ad) this.ad = wx.createRewardedVideoAd({ adUnitId: this.unitId });
        this.cb = onReward;
        this.closeHandler = (res: { isEnded?: boolean }) => {
            this.ad?.offClose(this.closeHandler!);
            if (res && res.isEnded) {
                const cb = this.cb;
                this.cb = null;
                if (cb) cb();
            }
        };
        this.ad.onClose(this.closeHandler);
        this.ad.show().catch(() =>
            this.ad!.load().then(() => this.ad!.show()).catch((e) => {
                // 拉起失败：显式抛错，不静默降级
                throw new Error('激励视频拉起失败: ' + String(e));
            }),
        );
    }

    update(_dtRaw: number) { /* wx 层由平台回调驱动 */ }
}

/** 工厂：按配置返回实现 */
export function newAdService(cfg: GameConfig): AdService {
    if (cfg.ad.mode === 'wx') {
        if (!cfg.ad.adUnitId) throw new Error('ad.mode=wx 但 ad.adUnitId 为空（schema 应已拦截）');
        return new WxAdService(cfg.ad.adUnitId);
    }
    return new MockAdService(cfg);
}
