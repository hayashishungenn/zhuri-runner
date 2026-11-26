/**
 * AdStats —— 本地商业化行为统计（Phase 7）。
 * 记录事件：run_start/run_end/revive/ad_request/ad_show/ad_complete/ad_reward/ad_fail。
 * 仅本地统计，不上传、不收集个人信息。
 */
import type { AdFailReason } from '../platform/AdService';

export interface AdEvent {
    t: number;                 // 时间戳（ms）
    type: string;
    scene: string;
    detail?: string;
}

/** 插屏频控持久化状态（Phase 8：跨会话仍受首局保护/每日上限约束） */
export interface AdInterstitialState {
    date: string;
    shownToday: number;
    lastAt: number;
    completedRuns: number;
}

export interface AdStatsData {
    events: AdEvent[];
    interstitial: AdInterstitialState;
    totals: {
        runs: number;
        ends: number;
        revives: number;
        requests: number;
        shows: number;
        completes: number;
        rewards: number;
        fails: number;
    };
}

export function defaultAdStats(): AdStatsData {
    return {
        events: [],
        interstitial: { date: '', shownToday: 0, lastAt: 0, completedRuns: 0 },
        totals: { runs: 0, ends: 0, revives: 0, requests: 0, shows: 0, completes: 0, rewards: 0, fails: 0 },
    };
}

/** 与默认结构合并（旧存档缺字段时补齐） */
export function mergeAdStats(data?: AdStatsData | null): AdStatsData {
    const def = defaultAdStats();
    if (!data) return def;
    return {
        ...def, ...data,
        events: Array.isArray(data.events) ? data.events : [],
        interstitial: { ...def.interstitial, ...(data.interstitial ?? {}) },
        totals: { ...def.totals, ...(data.totals ?? {}) },
    };
}

/** 本地日期（与 Game.today() 同口径） */
export function localDate(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class AdStats {
    data: AdStatsData;
    private maxEvents = 256;

    constructor(data?: AdStatsData) {
        this.data = data ?? defaultAdStats();
    }

    record(type: string, scene = '', detail = ''): void {
        this.data.events.push({ t: Date.now(), type, scene, detail });
        if (this.data.events.length > this.maxEvents) this.data.events.shift();
        const key = ({
            run_start: 'runs', run_end: 'ends', revive: 'revives',
            ad_request: 'requests', ad_show: 'shows', ad_complete: 'completes',
            ad_reward: 'rewards', ad_fail: 'fails',
        } as Record<string, keyof AdStatsData['totals']>)[type];
        if (key) this.data.totals[key] = (this.data.totals[key] as number) + 1;
    }

    fail(scene: string, reason: AdFailReason): void {
        this.record('ad_fail', scene, reason);
    }
}
