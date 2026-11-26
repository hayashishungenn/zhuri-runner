/**
 * Quests —— 每日任务（Phase 6）：32 个模板按日期抽取 3 个，进度统计 + 幂等领取。
 * 日期切换自动刷新；时间回拨按同日处理（防刷）。零 cc 依赖。
 */
export type QuestMetric =
    | 'runLi' | 'totalLi' | 'runFrags' | 'totalFrags'
    | 'obstaclesPassed' | 'obstaclesSmashed'
    | 'useDash' | 'useMagnet' | 'useLeap' | 'useShield' | 'useWater' | 'useStaff'
    | 'turns' | 'coolEvents' | 'themeDesert' | 'journeyDone';

export interface QuestTemplate {
    id: string;
    label: string;
    metric: QuestMetric;
    goal: number;
    reward: number;
}

/** 32 个任务模板（≥30 达标） */
export const QUEST_TEMPLATES: QuestTemplate[] = [
    { id: 'run_li_500', label: '单局奔行 500 里', metric: 'runLi', goal: 500, reward: 100 },
    { id: 'run_li_1000', label: '单局奔行 1000 里', metric: 'runLi', goal: 1000, reward: 150 },
    { id: 'run_li_2000', label: '单局奔行 2000 里', metric: 'runLi', goal: 2000, reward: 200 },
    { id: 'run_li_3000', label: '单局奔行 3000 里', metric: 'runLi', goal: 3000, reward: 300 },
    { id: 'tot_li_2000', label: '今日累计 2000 里', metric: 'totalLi', goal: 2000, reward: 120 },
    { id: 'tot_li_4000', label: '今日累计 4000 里', metric: 'totalLi', goal: 4000, reward: 180 },
    { id: 'tot_li_8000', label: '今日累计 8000 里', metric: 'totalLi', goal: 8000, reward: 260 },
    { id: 'run_frag_15', label: '单局拾取 15 枚阳炎', metric: 'runFrags', goal: 15, reward: 100 },
    { id: 'run_frag_30', label: '单局拾取 30 枚阳炎', metric: 'runFrags', goal: 30, reward: 160 },
    { id: 'run_frag_50', label: '单局拾取 50 枚阳炎', metric: 'runFrags', goal: 50, reward: 220 },
    { id: 'tot_frag_40', label: '今日累计 40 枚阳炎', metric: 'totalFrags', goal: 40, reward: 120 },
    { id: 'tot_frag_80', label: '今日累计 80 枚阳炎', metric: 'totalFrags', goal: 80, reward: 180 },
    { id: 'tot_frag_150', label: '今日累计 150 枚阳炎', metric: 'totalFrags', goal: 150, reward: 260 },
    { id: 'pass_20', label: '越过 20 个障碍', metric: 'obstaclesPassed', goal: 20, reward: 100 },
    { id: 'pass_40', label: '越过 40 个障碍', metric: 'obstaclesPassed', goal: 40, reward: 160 },
    { id: 'smash_2', label: '神杖击碎 2 个障碍', metric: 'obstaclesSmashed', goal: 2, reward: 120 },
    { id: 'smash_4', label: '神杖击碎 4 个障碍', metric: 'obstaclesSmashed', goal: 4, reward: 180 },
    { id: 'use_dash_1', label: '使用 1 次御风疾行', metric: 'useDash', goal: 1, reward: 80 },
    { id: 'use_dash_2', label: '使用 2 次御风疾行', metric: 'useDash', goal: 2, reward: 140 },
    { id: 'use_magnet_1', label: '使用 1 次灵光引聚', metric: 'useMagnet', goal: 1, reward: 80 },
    { id: 'use_magnet_2', label: '使用 2 次灵光引聚', metric: 'useMagnet', goal: 2, reward: 140 },
    { id: 'use_leap_1', label: '使用 1 次巨人之跃', metric: 'useLeap', goal: 1, reward: 80 },
    { id: 'use_leap_2', label: '使用 2 次巨人之跃', metric: 'useLeap', goal: 2, reward: 140 },
    { id: 'use_shield_1', label: '使用 1 次山岳护体', metric: 'useShield', goal: 1, reward: 80 },
    { id: 'use_shield_2', label: '使用 2 次山岳护体', metric: 'useShield', goal: 2, reward: 140 },
    { id: 'use_water_1', label: '饮用 1 次甘霖', metric: 'useWater', goal: 1, reward: 80 },
    { id: 'use_water_2', label: '饮用 2 次甘霖', metric: 'useWater', goal: 2, reward: 140 },
    { id: 'use_staff_1', label: '使用 1 次桃木神杖', metric: 'useStaff', goal: 1, reward: 90 },
    { id: 'use_staff_2', label: '使用 2 次桃木神杖', metric: 'useStaff', goal: 2, reward: 150 },
    { id: 'turns_3', label: '通过 3 处路口', metric: 'turns', goal: 3, reward: 120 },
    { id: 'turns_6', label: '通过 6 处路口', metric: 'turns', goal: 6, reward: 180 },
    { id: 'cool_3', label: '清凉水花 3 次', metric: 'coolEvents', goal: 3, reward: 120 },
    { id: 'theme_desert', label: '抵达极西荒漠', metric: 'themeDesert', goal: 1, reward: 150 },
    { id: 'journey_done', label: '完成一次逐日征途', metric: 'journeyDone', goal: 1, reward: 300 },
];
void QUEST_TEMPLATES;

/** 今日任务快照（持久化于存档 quests 段；picks 存模板 id） */
export interface DailyQuestState {
    date: string;
    picks: string[];
    progress: Record<string, number>;
    claimed: string[];
}

/** 由日期字符串生成稳定种子（date 为 YYYY-MM-DD） */
function dateSeed(date: string): number {
    let h = 2166136261;
    for (let i = 0; i < date.length; i++) { h ^= date.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

/** 规范化日期（容错：非法输入回落 1970-01-01） */
export function normalizeDate(d: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '1970-01-01';
}

export class DailyQuests {
    state: DailyQuestState;
    private lastSeenDate: string;

    constructor(state: DailyQuestState, today: string) {
        // 深拷贝：rolloverIfNeeded 会替换 progress/picks/claimed，不能继续引用存档对象
        this.state = {
            ...state,
            picks: [...(state.picks ?? [])],
            claimed: [...(state.claimed ?? [])],
            progress: { ...(state.progress ?? {}) },
        };
        this.lastSeenDate = normalizeDate(today);
        this.rolloverIfNeeded(today);
    }

    private templateOf(id: string): QuestTemplate | undefined {
        return QUEST_TEMPLATES.find((t) => t.id === id);
    }

    /** 日期切换（含回拨保护：仅当新日期 > 当前日期才刷新，回拨维持当日任务防刷） */
    rolloverIfNeeded(today: string): void {
        const t = normalizeDate(today);
        if (this.state.date && t <= this.state.date) return;   // 回拨维持当日（空日期视为首日必须刷新）
        this.state.date = t;
        this.state.progress = {};
        this.state.claimed = [];
        this.state.picks = this.pick3(t).map((t2) => t2.id);
    }

    /** 跨局累计进度（由存档 stats 增量驱动） */
    addProgress(metric: QuestMetric, amount: number): void {
        this.state.progress[metric] = (this.state.progress[metric] ?? 0) + amount;
    }

    /** 新局开始：清空单局峰值指标（否则跨局累积，任务被错误提前完成） */
    resetRunMetrics(): void {
        delete this.state.progress.runLi;
        delete this.state.progress.runFrags;
    }

    /** 单局快照类任务：单局峰值覆盖 */
    setRunMetric(metric: 'runLi' | 'runFrags', value: number): void {
        this.state.progress[metric] = Math.max(this.state.progress[metric] ?? 0, value);
    }

    progressOf(tpl: QuestTemplate): number {
        return Math.min(this.state.progress[tpl.metric] ?? 0, tpl.goal);
    }

    isComplete(tpl: QuestTemplate): boolean {
        return this.progressOf(tpl) >= tpl.goal;
    }

    isClaimed(tpl: QuestTemplate): boolean {
        return this.state.claimed.includes(tpl.id);
    }

    /** 领取标记（幂等：读写传入的领取仓，与存档 quests.claimed 同源） */
    claim(tpl: QuestTemplate, claimedStore: string[]): boolean {
        if (claimedStore.includes(tpl.id) || this.isClaimed(tpl)) return false;
        claimedStore.push(tpl.id);
        this.state.claimed = claimedStore;
        return true;
    }

    /** 今日任务（id 解析为模板；id 失效的条目自动由当日抽取补齐由 rollover 处理） */
    todays(): QuestTemplate[] {
        const out: QuestTemplate[] = [];
        for (const id of this.state.picks) {
            const t = this.templateOf(id);
            if (t) out.push(t);
        }
        return out;
    }

    private pick3(date: string): QuestTemplate[] {
        let s = dateSeed(date);
        const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
        const pool = [...QUEST_TEMPLATES];
        const picks: QuestTemplate[] = [];
        for (let i = 0; i < 3 && pool.length; i++) {
            const k = Math.floor(next() * pool.length) % pool.length;
            picks.push(...pool.splice(k, 1));
        }
        return picks;
    }
}
