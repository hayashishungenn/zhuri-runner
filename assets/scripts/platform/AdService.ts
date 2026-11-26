/**
 * AdService v2 —— 广告状态机与事务（Phase 7）。零 cc 依赖，可注入平台/模拟适配器单测。
 *
 * 硬约束：
 * - 仅 isEnded=true（微信官方完整观看判据）才发奖；每次广告事务最多结算一次
 * - 加载失败/无填充/取消/超时/流量主未开通 → 明确失败状态，不阻断游戏
 * - 正式包（微信环境）禁用模拟适配器：mock 模式在微信端返回不支持，不发奖
 * - 插屏仅在自然结算节点展示，带总开关/首局保护/冷却/频次上限
 */
import { IPlatform, IRewardedAdapter, IInterstitialAdapter } from './IPlatform';
import { AdStats, AdStatsData, defaultAdStats } from '../core/AdStats';

export type AdScene = 'revive' | 'doubleCoins' | 'dailyDouble' | 'timedPower' | 'skinTrial';
export type AdFailReason =
    | 'unsupported' | 'noAdUnit' | 'noFill' | 'loadFailed' | 'showFailed'
    | 'cancelled' | 'timeout' | 'notEnded' | 'duplicate' | 'cooldown' | 'disabled';

export type AdState = 'idle' | 'loading' | 'showing' | 'rewarded' | 'failed';

export interface AdResult {
    rewarded: boolean;
    reason?: AdFailReason;
    txId: string;
}

export interface AdServiceCfg {
    /** mock | wx —— 微信环境强制忽略 mock（不发奖） */
    mode: 'mock' | 'wx';
    /** 按场景的广告位 ID（空字符串 = 明确不支持） */
    adUnitIds: Partial<Record<AdScene, string>>;
    interstitialUnitId: string;
    /** 激励视频展示超时（毫秒） */
    timeoutMs: number;
    /** 插屏：总开关/首局保护局数/冷却毫秒/每日上限 */
    interstitial: { enabled: boolean; firstRunProtection: number; cooldownMs: number; maxPerDay: number };
}

export class AdService {
    readonly stats: AdStats;
    state: AdState = 'idle';
    lastFailReason: AdFailReason | null = null;
    /** 事务防重放：已完成事务 id */
    private settled = new Set<string>();
    private inFlight: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** 插屏频控（本地内存；存档可注入恢复） */
    interstitialShownToday = 0;
    lastInterstitialAt = 0;
    completedRuns = 0;

    constructor(private platform: IPlatform, private cfg: AdServiceCfg, statsData?: AdStatsData,
        /** 仅浏览器测试环境可注入模拟适配器；正式包不注入 */
        private mockRewarded?: IRewardedAdapter, private mockInterstitial?: IInterstitialAdapter) {
        this.stats = new AdStats(statsData ?? defaultAdStats());
    }

    /** 广告是否可用（明确状态，不伪造） */
    canUse(scene: AdScene): { ok: boolean; reason?: AdFailReason } {
        // 微信环境的 mock 模式：隔离，不发奖
        if (this.platform.isWechat && this.cfg.mode === 'mock') {
            return { ok: false, reason: 'unsupported' };
        }
        const id = this.cfg.adUnitIds[scene];
        if (!id) return { ok: false, reason: 'noAdUnit' };
        if (this.platform.isWechat) return { ok: true };
        // 浏览器：仅显式注入模拟适配器时可用（测试模式，奖励不进入正式统计）
        return this.mockRewarded?.supported ? { ok: true } : { ok: false, reason: 'unsupported' };
    }

    /** 激励视频：加载→展示→关闭→发奖（一次事务最多结算一次） */
    requestReward(scene: AdScene, onReward: (result: AdResult) => void): Promise<AdResult> {
        const txId = `${scene}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
        const check = this.canUse(scene);
        if (!check.ok) {
            this.state = 'failed';
            this.lastFailReason = check.reason!;
            this.stats.fail(scene, check.reason!);
            return Promise.resolve({ rewarded: false, reason: check.reason, txId });
        }
        if (this.inFlight) {
            this.stats.fail(scene, 'duplicate');
            return Promise.resolve({ rewarded: false, reason: 'duplicate', txId });
        }
        this.inFlight = txId;
        this.state = 'loading';
        this.lastFailReason = null;
        this.stats.record('ad_request', scene);
        const adapter = this.rewardedAdapter(scene)!;

        return adapter.load().then((ok) => {
            if (!ok) throw new Error('noFill');
            this.state = 'showing';
            this.stats.record('ad_show', scene);
            return new Promise<AdResult>((resolve) => {
                let settled = false;
                const finish = (rewarded: boolean, reason?: AdFailReason) => {
                    if (settled) {                      // ★ 重复回调只记录，不重复结算
                        this.stats.fail(scene, 'duplicate');
                        return;
                    }
                    settled = true;
                    this.clearTimer();
                    this.inFlight = null;
                    if (rewarded) {
                        if (this.settled.has(txId)) {   // 事务防重放
                            resolve({ rewarded: false, reason: 'duplicate', txId });
                            return;
                        }
                        this.settled.add(txId);
                        this.state = 'rewarded';
                        this.stats.record('ad_complete', scene);
                        this.stats.record('ad_reward', scene);
                        resolve({ rewarded: true, txId });
                    } else {
                        this.state = 'failed';
                        this.lastFailReason = reason ?? 'notEnded';
                        this.stats.fail(scene, reason ?? 'notEnded');
                        resolve({ rewarded: false, reason: reason ?? 'notEnded', txId });
                    }
                };
                // 超时守护（模拟适配器 timeout 分支依赖此机制）
                this.timer = setTimeout(() => finish(false, 'timeout'), this.cfg.timeoutMs);
                adapter.show((isEnded: boolean) => {
                    // 微信官方判据：只有 isEnded=true 才算完整观看
                    finish(isEnded, isEnded ? undefined : 'notEnded');
                }).catch((e: Error) => {
                    const reason: AdFailReason = String(e.message).includes('fill') ? 'noFill' : 'showFailed';
                    finish(false, reason);
                });
            });
        }).catch((e: Error) => {
            const reason: AdFailReason = String(e.message).includes('fill') ? 'noFill' : 'loadFailed';
            this.clearTimer();
            this.inFlight = null;
            this.state = 'failed';
            this.lastFailReason = reason;
            this.stats.fail(scene, reason);
            return { rewarded: false, reason, txId };
        }).then((result: AdResult) => {
            if (result.rewarded) onReward(result);      // 发奖回调仅一次
            return result;
        });
    }

    private rewardedAdapter(scene: AdScene): IRewardedAdapter | null {
        if (this.platform.isWechat) return this.platform.rewardedAd(this.cfg.adUnitIds[scene] ?? '');
        return this.mockRewarded ?? null;
    }

    private clearTimer(): void {
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    }

    /** 插屏：仅自然结算节点调用；所有限制生效时返回 false（不打断游戏） */
    maybeShowInterstitial(): boolean {
        const c = this.cfg.interstitial;
        if (!c.enabled) return false;
        if (this.completedRuns < c.firstRunProtection) return false;
        const now = Date.now();
        if (now - this.lastInterstitialAt < c.cooldownMs) return false;
        if (this.interstitialShownToday >= c.maxPerDay) return false;
        if (!this.cfg.interstitialUnitId) return false;
        const adapter: IInterstitialAdapter | null = this.platform.isWechat
            ? this.platform.interstitialAd(this.cfg.interstitialUnitId)
            : (this.mockInterstitial ?? null);
        if (!adapter?.supported) return false;
        adapter.load().then((ok) => { if (ok) { adapter.show().catch(() => { /* 插屏失败不阻断 */ }); } })
            .catch(() => { /* 加载失败不阻断 */ });
        this.lastInterstitialAt = now;
        this.interstitialShownToday++;
        this.completedRuns++;
        return true;
    }

    /** 记录一局结束（插屏首局保护计数） */
    noteRunEnd(): void { this.completedRuns++; }
}
