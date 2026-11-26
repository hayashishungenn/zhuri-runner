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
import { AdStats, AdStatsData, localDate, mergeAdStats } from '../core/AdStats';

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
    /** 总开关：false = 全部广告场景明确不可用（可玩性测试期，UI 同步隐藏入口） */
    enabled: boolean;
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
    private inFlight: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** 切后台时冻结超时：避免玩家完整观看却因后台延迟被判 timeout */
    private pausedAt: number | null = null;
    private remainingMs = 0;
    private timerStartedAt = 0;
    private finishPending: ((rewarded: boolean, reason?: AdFailReason) => void) | null = null;
    /** 适配器缓存：避免每次 canUse 重复创建微信广告实例 */
    private adapters = new Map<string, IRewardedAdapter>();

    constructor(private platform: IPlatform, private cfg: AdServiceCfg, statsData?: AdStatsData,
        /** 仅浏览器测试环境可注入模拟适配器；正式包不注入 */
        private mockRewarded?: IRewardedAdapter, private mockInterstitial?: IInterstitialAdapter) {
        this.stats = new AdStats(mergeAdStats(statsData));
        this.applyInterstitialState();
    }

    /** 插屏频控状态（持久化于存档 ads 段；跨会话仍受首局保护/每日上限约束） */
    get interstitialShownToday(): number { return this.stats.data.interstitial.shownToday; }
    set interstitialShownToday(v: number) { this.stats.data.interstitial.shownToday = v; }
    get lastInterstitialAt(): number { return this.stats.data.interstitial.lastAt; }
    set lastInterstitialAt(v: number) { this.stats.data.interstitial.lastAt = v; }
    get completedRuns(): number { return this.stats.data.interstitial.completedRuns; }
    set completedRuns(v: number) { this.stats.data.interstitial.completedRuns = v; }

    /** 换档/恢复备份：重新装载统计与频控状态 */
    loadStats(data?: AdStatsData | null): void {
        this.stats.data = mergeAdStats(data);
        this.applyInterstitialState();
    }

    private applyInterstitialState(): void {
        const st = this.stats.data.interstitial;
        const today = localDate();
        if (st.date !== today) {
            st.date = today;
            st.shownToday = 0;
            st.lastAt = 0;
        }
    }

    /** 广告是否可用（明确状态，不伪造） */
    canUse(scene: AdScene): { ok: boolean; reason?: AdFailReason } {
        // 总开关关闭：全部场景明确不可用
        if (!this.cfg.enabled) return { ok: false, reason: 'disabled' };
        // 微信环境的 mock 模式：隔离，不发奖
        if (this.platform.isWechat && this.cfg.mode === 'mock') {
            return { ok: false, reason: 'unsupported' };
        }
        const id = this.cfg.adUnitIds[scene];
        if (!id) return { ok: false, reason: 'noAdUnit' };
        if (this.platform.isWechat) {
            return this.rewardedAdapter(scene)?.supported
                ? { ok: true }
                : { ok: false, reason: 'unsupported' };
        }
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
                    this.finishPending = null;
                    this.inFlight = null;
                    if (rewarded) {
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
                this.finishPending = finish;
                this.remainingMs = this.cfg.timeoutMs;
                this.timerStartedAt = Date.now();
                this.timer = setTimeout(() => finish(false, 'timeout'), this.remainingMs);
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
        if (!this.platform.isWechat) return this.mockRewarded ?? null;
        const id = this.cfg.adUnitIds[scene] ?? '';
        if (!id) return null;
        let a = this.adapters.get(scene);
        if (!a) { a = this.platform.rewardedAd(id); this.adapters.set(scene, a); }
        return a;
    }

    private clearTimer(): void {
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        this.pausedAt = null;
    }

    /** 切后台：冻结广告超时计时（回调可能延迟到回前台后才到达） */
    onHide(): void {
        if (this.timer === null || this.pausedAt !== null) return;
        this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.timerStartedAt));
        clearTimeout(this.timer);
        this.timer = null;
        this.pausedAt = Date.now();
    }

    /** 回前台：按剩余时间恢复超时守护 */
    onShow(): void {
        if (this.pausedAt === null || this.state !== 'showing') return;
        this.pausedAt = null;
        if (this.remainingMs > 0) {
            this.timerStartedAt = Date.now();
            this.timer = setTimeout(() => this.finishPending?.(false, 'timeout'), this.remainingMs);
        }
    }

    /** 插屏：仅自然结算节点调用；所有限制生效时返回 false（不打断游戏） */
    maybeShowInterstitial(): boolean {
        this.applyInterstitialState();
        const c = this.cfg.interstitial;
        if (!this.cfg.enabled || !c.enabled) return false;
        if (this.completedRuns < c.firstRunProtection) return false;
        const now = Date.now();
        if (now - this.lastInterstitialAt < c.cooldownMs) return false;
        if (this.interstitialShownToday >= c.maxPerDay) return false;
        if (!this.cfg.interstitialUnitId) return false;
        const adapter: IInterstitialAdapter | null = this.platform.isWechat
            ? this.platform.interstitialAd(this.cfg.interstitialUnitId)
            : (this.mockInterstitial ?? null);
        if (!adapter?.supported) return false;
        // 同步占用配额（防同帧反复触发）；加载/展示失败时退还计数，冷却保留用于防刷
        this.lastInterstitialAt = now;
        this.interstitialShownToday++;
        const refund = () => {
            if (this.lastInterstitialAt === now) this.interstitialShownToday = Math.max(0, this.interstitialShownToday - 1);
        };
        adapter.load().then((ok) => {
            if (!ok) { refund(); return; }
            return adapter.show().catch(() => { refund(); });
        }).catch(() => { refund(); });
        return true;
    }

    /** 记录一局自然结束（插屏首局保护计数；每局只调用一次，跨会话持久化） */
    noteRunEnd(): void {
        this.applyInterstitialState();
        this.stats.data.interstitial.completedRuns++;
    }

    /** 场景销毁：取消未决定时器，避免回调写入已销毁实例 */
    dispose(): void {
        this.clearTimer();
        this.finishPending = null;
        this.inFlight = null;
        this.adapters.clear();
    }
}
