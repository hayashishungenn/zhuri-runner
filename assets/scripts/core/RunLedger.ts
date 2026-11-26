/**
 * RunLedger —— 单局事务账本（Phase 8.1 升级）。
 * 纯逻辑、零 cc 依赖：
 * - 跨局严格单调唯一的 runId（currentSeed）
 * - 累计取整金币增量（修复逐枚拾取 Math.round 导致 +15%/+30% 强化失效的缺陷）
 * - 复活后增量结算（修复复活后第二次死亡被 claimSettlement 拦截导致统计遗漏的缺陷）
 * - 单局 doubleCoins 广告翻倍幂等锁
 * - 教程参数以不可变 RunModeOverrides 返回，绝不修改共享 GameConfig
 */
import { RunModeOverrides } from './types';

export const TUTORIAL_OVERRIDES: Readonly<RunModeOverrides> = {
    spawnRowInterval: 16,
    turnGapMin: 30,
    turnGapMax: 60,
};

export interface FragmentGrant {
    txId: string;
    amount: number;
}

export interface SettlementDelta {
    /** 本局首次结算（用于插屏/局数统计，复活后二次结算为 false） */
    isFirstSettle: boolean;
    deltaLi: number;
    deltaFrags: number;
    deltaGold: number;
}

export class RunLedger {
    private seed = 0;
    private lastFrags = 0;
    private grantedGold = 0;
    private tutorialRun = false;
    private settledOnce = false;
    private revivedSinceSettle = false;
    private settledLi = 0;
    private settledFrags = 0;
    private settledGold = 0;
    private doubleCoinsClaimed = false;
    runs = 0;

    get currentSeed(): number { return this.seed; }
    get isTutorialRun(): boolean { return this.tutorialRun; }
    get totalGrantedGold(): number { return this.grantedGold; }
    get isDoubleCoinsClaimed(): boolean { return this.doubleCoinsClaimed; }

    /**
     * 开始一局：生成跨局唯一 runId，返回该局应注入 GameCore 的模式覆写（不修改共享配置）。
     */
    beginRun(tutorial = false): { runId: number; overrides: RunModeOverrides | null } {
        this.tutorialRun = tutorial;
        const nextSeed = Date.now() * 1000 + this.runs;
        this.seed = nextSeed > this.seed ? nextSeed : this.seed + 1;
        this.lastFrags = 0;
        this.grantedGold = 0;
        this.settledOnce = false;
        this.revivedSinceSettle = false;
        this.settledLi = 0;
        this.settledFrags = 0;
        this.settledGold = 0;
        this.doubleCoinsClaimed = false;
        this.runs++;
        return {
            runId: this.seed,
            overrides: tutorial ? { ...TUTORIAL_OVERRIDES } : null,
        };
    }

    /** 结束教程（完成或跳过）：返回 null 供调用方清除 GameCore 单局覆写 */
    endTutorial(): RunModeOverrides | null {
        this.tutorialRun = false;
        return null;
    }

    /** 标记本局已复活：允许最终死亡/通关时补记复活后的增量统计 */
    noteRevive(): void {
        this.revivedSinceSettle = true;
    }

    /**
     * 阳炎增量换金币：按累计目标值做差，杜绝逐枚 Math.round 吞掉 +15%/+30% 强化倍率。
     */
    fragmentGrant(frags: number, goldMul: number): FragmentGrant | null {
        if (frags <= this.lastFrags) return null;
        this.lastFrags = frags;
        const mul = Math.max(1, goldMul);
        const targetTotal = Math.round(frags * mul);
        const amount = targetTotal - this.grantedGold;
        if (amount <= 0) return null;
        this.grantedGold = targetTotal;
        return { txId: `frag:${this.seed}:${frags}`, amount };
    }

    /**
     * 单局结算（支持复活后二次增量结算，禁止无复活时的重复结算）。
     * @returns 本次应入账的增量；重复结算或非本局返回 null
     */
    claimSettlement(runId: number, currentLi = 0, currentFrags = 0): SettlementDelta | null {
        if (runId !== this.seed) return null;
        if (this.settledOnce && !this.revivedSinceSettle) return null;
        const isFirstSettle = !this.settledOnce;
        const liFloor = Math.max(0, Math.floor(currentLi));
        const fragsInt = Math.max(0, Math.floor(currentFrags));
        const deltaLi = Math.max(0, liFloor - this.settledLi);
        const deltaFrags = Math.max(0, fragsInt - this.settledFrags);
        const deltaGold = Math.max(0, this.grantedGold - this.settledGold);
        this.settledLi = Math.max(this.settledLi, liFloor);
        this.settledFrags = Math.max(this.settledFrags, fragsInt);
        this.settledGold = Math.max(this.settledGold, this.grantedGold);
        this.settledOnce = true;
        this.revivedSinceSettle = false;
        return { isFirstSettle, deltaLi, deltaFrags, deltaGold };
    }

    /** 单局金币翻倍广告幂等锁：每局最多领取一次 */
    claimDoubleCoins(runId: number): string | null {
        if (runId !== this.seed || this.doubleCoinsClaimed) return null;
        this.doubleCoinsClaimed = true;
        return `addouble:${runId}`;
    }
}
