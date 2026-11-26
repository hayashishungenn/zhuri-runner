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

export interface AdStatsData {
    events: AdEvent[];
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
        totals: { runs: 0, ends: 0, revives: 0, requests: 0, shows: 0, completes: 0, rewards: 0, fails: 0 },
    };
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
