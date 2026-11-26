/**
 * RunLedger —— 单局事务账本（Phase 8 质量审查修复）。
 * 纯逻辑、零 cc 依赖：负责跨局唯一事务 id、实时金币增量、教程参数覆写与还原。
 * 历史缺陷：Game 中 lastFragsForGold/runSeed 跨局不重置 → 复用旧事务 id 导致金币丢失；
 * 教程直接改写共享配置 → 之后所有局都变成稀疏生成。此处集中修复并可在 Node 单测。
 */

/** 教程局临时参数（结束后必须还原，避免污染正式局） */
export interface SpawnTuning { rowInterval: number; }
export interface MapTuning { turnGapMin: number; turnGapMax: number; }

const TUTORIAL_SPAWN_INTERVAL = 16;
const TUTORIAL_TURN_GAP_MIN = 30;
const TUTORIAL_TURN_GAP_MAX = 60;

interface TuningBackup {
    rowInterval: number;
    turnGapMin: number;
    turnGapMax: number;
}

export interface FragmentGrant {
    txId: string;
    amount: number;
}

export class RunLedger {
    private seed = 0;
    private lastFrags = 0;
    private backup: TuningBackup | null = null;
    private tutorialRun = false;
    private settledSeed = -1;
    runs = 0;

    get currentSeed(): number { return this.seed; }
    get isTutorialRun(): boolean { return this.tutorialRun; }

    /**
     * 开始一局：重置增量基准、生成跨局唯一 seed；教程参数仅在首次进入时备份。
     * @returns 本局 seed（用于结算去重）
     */
    beginRun(spawn: SpawnTuning, map: MapTuning, tutorial: boolean): number {
        if (this.tutorialRun && !tutorial) this.restoreTuning(spawn, map);
        if (tutorial && !this.tutorialRun) {
            this.backup = {
                rowInterval: spawn.rowInterval,
                turnGapMin: map.turnGapMin,
                turnGapMax: map.turnGapMax,
            };
            spawn.rowInterval = TUTORIAL_SPAWN_INTERVAL;
            map.turnGapMin = TUTORIAL_TURN_GAP_MIN;
            map.turnGapMax = TUTORIAL_TURN_GAP_MAX;
        }
        this.tutorialRun = tutorial;
        this.seed = Date.now() * 100 + this.runs;
        this.lastFrags = 0;
        this.settledSeed = -1;
        this.runs++;
        return this.seed;
    }

    /** 结束教程（完成或跳过）：立即还原配置，不等待下一局 */
    endTutorial(spawn: SpawnTuning, map: MapTuning): void {
        this.restoreTuning(spawn, map);
        this.tutorialRun = false;
    }

    private restoreTuning(spawn: SpawnTuning, map: MapTuning): void {
        if (!this.backup) return;
        spawn.rowInterval = this.backup.rowInterval;
        map.turnGapMin = this.backup.turnGapMin;
        map.turnGapMax = this.backup.turnGapMax;
        this.backup = null;
    }

    /** 阳炎增量换金币：事务 id 含本局 seed，跨局不会复用 */
    fragmentGrant(frags: number, goldMul: number): FragmentGrant | null {
        if (frags <= this.lastFrags) return null;
        const delta = frags - this.lastFrags;
        this.lastFrags = frags;
        return { txId: `frag:${this.seed}:${frags}`, amount: Math.round(delta * Math.max(1, goldMul)) };
    }

    /** 单局结算去重：同一 seed 只结算一次 */
    claimSettlement(seed: number): boolean {
        if (seed !== this.seed || this.settledSeed === seed) return false;
        this.settledSeed = seed;
        return true;
    }
}
