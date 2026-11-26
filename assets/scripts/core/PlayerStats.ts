/**
 * PlayerStats —— 累计统计（Phase 6/8.1 成长/任务/成就的数据源）。零 cc 依赖。
 * 由核心事件流驱动累加；持久化委托 Save.stats。
 */
import { CoreEvent, GameState } from './types';
import { StatsSaveState } from '../platform/Save';

const THEME_COUNT = 4;

export class PlayerStats {
    stats: StatsSaveState;

    constructor(initial: StatsSaveState) {
        this.stats = initial;
    }

    /** 每次起跑：计一局 */
    onRunStart(): void {
        this.stats.runs++;
    }

    /** 每帧事件流累加（由 Game 转发核心事件；fragment 优先采用事件携带的真实枚数 amount） */
    onEvents(events: CoreEvent[]): void {
        for (const e of events) {
            if (e.type === 'fragment') this.stats.totalFrags += e.amount ?? this.fragGain;
            else if (e.type === 'turnOk') this.stats.turns++;
            else if (e.type === 'obstaclePassed') this.stats.obstaclesPassed++;
            else if (e.type === 'obstacleSmashed' || e.type === 'staffBreak') this.stats.obstaclesSmashed++;
            else if (e.type === 'item') {
                const k = e.kind ?? '';
                this.stats.itemUses[k] = (this.stats.itemUses[k] ?? 0) + 1;
                if (k === 'water') this.stats.waterDrunk++;
            }
        }
    }

    private fragGain = 1;

    /** 倍率道具时由外部设置的兜底增益（当事件未携带 amount 时生效） */
    setFragGain(gain: number): void { this.fragGain = Math.max(1, Math.round(gain)); }

    /**
     * 单局结算（死亡/通关或复活后二次结算增量入账）。
     * @param deltaLi 本次结算新增里程
     * @param deltaFrags 本次结算新增阳炎
     * @param deltaGold 本次结算新增金币
     * @param state 结束状态（ended = 征途通关）
     * @param themeIdx 当前主题索引
     * @param maxThemeVisited 本局到达主题索引
     * @param isCoolRun 全程热量是否低于过热警戒（仅 true 时计入 coolRuns）
     * @param totalRunLi 本局总里程（用于更新 bestRunLi；默认等于 deltaLi）
     */
    onRunSettle(
        deltaLi: number,
        deltaFrags: number,
        deltaGold: number,
        state: GameState,
        themeIdx: number,
        maxThemeVisited: number,
        isCoolRun = false,
        totalRunLi?: number,
    ): void {
        void deltaFrags;
        void themeIdx;
        this.stats.totalLi += Math.max(0, Math.floor(deltaLi));
        this.stats.goldEarned += Math.max(0, Math.floor(deltaGold));
        const runBest = Math.floor(totalRunLi ?? deltaLi);
        if (runBest > this.stats.bestRunLi) this.stats.bestRunLi = runBest;
        if (state === 'ended') {
            if (isCoolRun) this.stats.coolRuns++;
            this.stats.itemUses.journey = (this.stats.itemUses.journey ?? 0) + 1;
            this.stats.themeVisited = Array.from(new Set([...this.stats.themeVisited, 0, 1, 2, 3])).sort((a, b) => a - b);
        } else if (maxThemeVisited >= 0) {
            this.visitTheme(maxThemeVisited);
        }
    }

    /** 记录已到达的主题（归一化到 [0, 3] 去重） */
    visitTheme(idx: number): void {
        if (!Number.isFinite(idx) || idx < 0) return;
        const norm = Math.floor(idx) % THEME_COUNT;
        if (!this.stats.themeVisited.includes(norm)) {
            this.stats.themeVisited = [...this.stats.themeVisited, norm].sort((a, b) => a - b);
        }
    }
}
