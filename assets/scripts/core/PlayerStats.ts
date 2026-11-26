/**
 * PlayerStats —— 累计统计（Phase 6 成长/任务/成就的数据源）。零 cc 依赖。
 * 由核心事件流驱动累加；持久化委托 Save.stats。
 */
import { CoreEvent, GameState } from './types';
import { StatsSaveState } from '../platform/Save';

export class PlayerStats {
    stats: StatsSaveState;

    constructor(initial: StatsSaveState) {
        this.stats = initial;
    }

    /** 每次起跑：计一局 */
    onRunStart(): void {
        this.stats.runs++;
    }

    /** 每帧事件流累加（由 Game 转发核心事件；milestone 由 li 阈值换算） */
    onEvents(events: CoreEvent[]): void {
        for (const e of events) {
            if (e.type === 'fragment') this.stats.totalFrags += this.fragGain;
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

    /** 倍率道具时由 Game 设置瞬时增益 */
    setFragGain(gain: number): void { this.fragGain = Math.max(1, Math.round(gain)); }

    /** 单局结算（死亡/通关时调用一次） */
    onRunSettle(runLi: number, runFrags: number, goldEarned: number, state: GameState, themeIdx: number, maxThemeVisited: number): void {
        this.stats.totalLi += Math.floor(runLi);
        this.stats.goldEarned += goldEarned;
        if (runLi > this.stats.bestRunLi) this.stats.bestRunLi = Math.floor(runLi);
        // 主题到达（运行中已按段收集，这里并入全局去重集合语义由外部维护）
        void themeIdx;
        if (state === 'ended') {
            // 通关且全程未触发热警戒
            this.stats.coolRuns++;
            this.stats.itemUses.journey = (this.stats.itemUses.journey ?? 0) + 1;
            this.stats.themeVisited = Array.from(new Set([...this.stats.themeVisited, 0, 1, 2, 3]));
        } else if (maxThemeVisited >= 0) {
            this.stats.themeVisited = Array.from(new Set([...this.stats.themeVisited, maxThemeVisited]));
        }
    }

    /** 记录已到达的最远主题（由 Game 在换段事件时调用） */
    visitTheme(idx: number): void {
        this.stats.themeVisited = Array.from(new Set([...this.stats.themeVisited, idx]));
    }
}
