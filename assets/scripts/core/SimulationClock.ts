/**
 * SimulationClock —— 固定时间步长与时钟管理（Phase 8.2.3）。零 cc 依赖。
 *
 * 明确区分四类时间语义：
 * - fixedTick / runTime：单局确定性模拟时钟（每局归零，驱动障碍相位与回放）
 * - gTime：全局表现时钟（跨标题/死亡连续推进，驱动天空/虚线等非玩法视觉）
 * - renderAlpha：[0, 1) 子帧插值因子（供渲染层在 >60Hz 下平滑插值）
 * - 现实时间 / 广告超时：由平台层 AdService 独立管理，不与本模块耦合
 */
export class SimulationClock {
    /** 固定逻辑步长（60 Hz） */
    static readonly FIXED_DT = 1 / 60;
    /** 单帧输入 dt 上限（后台恢复/卡顿防护） */
    static readonly MAX_FRAME_DT = 0.25;
    /** 单次 advance 最大逻辑子步数（防死亡螺旋） */
    static readonly MAX_SUB_STEPS = 8;

    fixedTick = 0;
    gTime = 0;
    runTime = 0;
    renderAlpha = 0;
    paused = false;

    private accumulator = 0;

    /** 单局重置：清零单局逻辑帧、单局时钟与累加器，保留全局视觉时钟 gTime */
    resetRun(): void {
        this.fixedTick = 0;
        this.runTime = 0;
        this.accumulator = 0;
        this.renderAlpha = 0;
        this.paused = false;
    }

    /** 暂停：冻结模拟推进（含 gTime） */
    pause(): void {
        this.paused = true;
    }

    /** 恢复：解除暂停并清零残留累加器，避免恢复瞬间突发追帧 */
    resume(): void {
        this.paused = false;
        this.accumulator = 0;
        this.renderAlpha = 0;
    }

    /** 后台切回前台：丢弃未消费帧时间，防止爆发追帧 */
    onBackgroundResume(): void {
        this.accumulator = 0;
        this.renderAlpha = 0;
    }

    /** 推进单局模拟时钟（由核心在 run 态按 timeScale 缩放后调用） */
    advanceRunTime(dtScaled: number): void {
        this.runTime += dtScaled;
    }

    /**
     * 累加渲染帧耗时并按 FIXED_DT 驱动固定逻辑步。
     * @returns 本帧实际执行的固定逻辑步数
     */
    advance(dtRaw: number, onStep: (dt: number) => void): number {
        if (this.paused) return 0;
        if (!Number.isFinite(dtRaw) || dtRaw <= 0) return 0;

        const clamped = Math.min(dtRaw, SimulationClock.MAX_FRAME_DT);
        this.accumulator += clamped;

        const STEP = SimulationClock.FIXED_DT;
        const EPS = 1e-9;
        let steps = 0;

        while (this.accumulator + EPS >= STEP && steps < SimulationClock.MAX_SUB_STEPS) {
            this.accumulator = Math.max(0, this.accumulator - STEP);
            this.fixedTick++;
            this.gTime += STEP;
            onStep(STEP);
            steps++;
            if (this.paused) break;
        }

        if (steps === SimulationClock.MAX_SUB_STEPS && this.accumulator > STEP) {
            this.accumulator = STEP * 0.999;
        }
        this.renderAlpha = Math.max(0, Math.min(1, this.accumulator / STEP));
        return steps;
    }
}
