/**
 * AdRewardCoordinator —— 广告奖励业务事务协调器（Phase 8.1）。零 cc 依赖。
 *
 * 解决以下缺陷：
 * 1. 绑定广告事务、游戏局身份（runId）与请求时刻快照（bonus/questId/date/trialSkinId）。
 * 2. 禁止同局金币重复翻倍（RunLedger.claimDoubleCoins 幂等锁 + 快照金额）。
 * 3. 限时神通（timedPower）存入待生效队列，在下一局 startRun({ startBuffs }) 时注入，不再被 reset 清零。
 * 4. 试用皮肤（skinTrial）绑定单局生命周期，单局结束或重开自动归还为玩家已拥有皮肤。
 * 5. 迟到回调若 runId/状态已变更，明确拒绝并不作用于错误游戏局。
 */
import type { AdScene } from '../platform/AdService';
import type { GameCore } from './GameCore';
import type { RunLedger } from './RunLedger';
import type { Economy } from './Economy';
import type { DailyQuests } from './Quests';
import type { StartRunBuffs } from './types';

export interface AdRewardTicket {
    scene: AdScene;
    runId: number;
    snapshot: {
        doubleCoinsBonus?: number;
        dailyDate?: string;
        dailyQuestId?: string;
        dailyReward?: number;
        timedBuffs?: StartRunBuffs;
        trialSkinId?: string;
    };
}

export interface AdTicketContext {
    core: GameCore;
    ledger: RunLedger;
    quests: DailyQuests;
    allSkinIds: string[];
    ownedSkins: string[];
    currentSkinId: string;
}

export interface AdApplyContext {
    core: GameCore;
    ledger: RunLedger;
    economy: Economy;
    quests: DailyQuests;
    questClaimedStore: string[];
}

export interface AdApplyOutcome {
    applied: boolean;
    reason?: string;
    bonus?: number;
    trialSkinId?: string;
}

export class AdRewardCoordinator {
    /** 待下一局开局注入的限时神通（不入存档，单次有效） */
    private pendingBuffs: StartRunBuffs | null = null;
    /** 待下一局生效的试用皮肤 id */
    private pendingTrialSkinId: string | null = null;
    /** 当前局正在试用的皮肤 id（null = 未试用） */
    private activeTrialSkinId: string | null = null;

    get hasPendingBuffs(): boolean { return this.pendingBuffs !== null; }
    get currentTrialSkinId(): string | null { return this.activeTrialSkinId ?? this.pendingTrialSkinId; }

    /**
     * 在发起广告请求前校验业务前置条件并生成绑定当前局与快照的票据。
     * 返回 null 表示当前不满足发奖前提（如本局已翻倍、无未领任务、不可复活）。
     */
    prepareTicket(scene: AdScene, ctx: AdTicketContext): AdRewardTicket | null {
        const runId = ctx.ledger.currentSeed;
        switch (scene) {
        case 'revive':
            if (!ctx.core.reviveUsable() || ctx.core.state !== 'dead') return null;
            return { scene, runId, snapshot: {} };

        case 'doubleCoins': {
            if (ctx.core.state !== 'dead' && ctx.core.state !== 'ended') return null;
            if (ctx.ledger.isDoubleCoinsClaimed) return null;
            const bonus = ctx.ledger.totalGrantedGold;
            if (bonus <= 0) return null;
            return { scene, runId, snapshot: { doubleCoinsBonus: bonus } };
        }

        case 'dailyDouble': {
            const tpl = ctx.quests.todays().find((t) => ctx.quests.isComplete(t) && !ctx.quests.isClaimed(t));
            if (!tpl) return null;
            return {
                scene,
                runId,
                snapshot: {
                    dailyDate: ctx.quests.state.date,
                    dailyQuestId: tpl.id,
                    dailyReward: tpl.reward * 2,
                },
            };
        }

        case 'timedPower':
            return {
                scene,
                runId,
                snapshot: { timedBuffs: { magnetT: 12, dashT: 3 } },
            };

        case 'skinTrial': {
            // 优先选择未拥有的皮肤试用；若全拥有则选下一套
            const unowned = ctx.allSkinIds.filter((id) => !ctx.ownedSkins.includes(id));
            const pool = unowned.length ? unowned : ctx.allSkinIds.filter((id) => id !== ctx.currentSkinId);
            const trialSkinId = pool[0] ?? ctx.currentSkinId;
            return { scene, runId, snapshot: { trialSkinId } };
        }
        }
    }

    /**
     * 广告完整观看回调到达时，按票据绑定的 runId 与快照安全兑现奖励。
     */
    applyReward(ticket: AdRewardTicket, ctx: AdApplyContext): AdApplyOutcome {
        const currentRunId = ctx.ledger.currentSeed;
        switch (ticket.scene) {
        case 'revive': {
            if (currentRunId !== ticket.runId) return { applied: false, reason: 'staleRun' };
            if (!ctx.core.revive()) return { applied: false, reason: 'invalidState' };
            ctx.ledger.noteRevive();
            return { applied: true };
        }

        case 'doubleCoins': {
            if (currentRunId !== ticket.runId) return { applied: false, reason: 'staleRun' };
            const txId = ctx.ledger.claimDoubleCoins(ticket.runId);
            if (!txId) return { applied: false, reason: 'alreadyClaimed' };
            const bonus = Math.max(0, Math.floor(ticket.snapshot.doubleCoinsBonus ?? 0));
            if (bonus <= 0) return { applied: false, reason: 'zeroBonus' };
            const granted = ctx.economy.grant(txId, bonus);
            return granted > 0
                ? { applied: true, bonus: granted }
                : { applied: false, reason: 'duplicateTx' };
        }

        case 'dailyDouble': {
            const { dailyDate, dailyQuestId, dailyReward } = ticket.snapshot;
            if (!dailyDate || !dailyQuestId || !dailyReward) return { applied: false, reason: 'invalidSnapshot' };
            if (ctx.quests.state.date !== dailyDate) return { applied: false, reason: 'dateChanged' };
            const tpl = ctx.quests.todays().find((t) => t.id === dailyQuestId);
            if (!tpl || !ctx.quests.isComplete(tpl) || ctx.quests.isClaimed(tpl)) {
                return { applied: false, reason: 'questUnavailable' };
            }
            if (!ctx.quests.claim(tpl, ctx.questClaimedStore)) {
                return { applied: false, reason: 'alreadyClaimed' };
            }
            const granted = ctx.economy.grant(`addaily:${dailyDate}:${dailyQuestId}`, dailyReward);
            return granted > 0
                ? { applied: true, bonus: granted }
                : { applied: false, reason: 'duplicateTx' };
        }

        case 'timedPower': {
            const buffs = ticket.snapshot.timedBuffs ?? { magnetT: 12, dashT: 3 };
            this.pendingBuffs = {
                magnetT: Math.max(this.pendingBuffs?.magnetT ?? 0, buffs.magnetT ?? 0),
                dashT: Math.max(this.pendingBuffs?.dashT ?? 0, buffs.dashT ?? 0),
            };
            return { applied: true };
        }

        case 'skinTrial': {
            const trialSkinId = ticket.snapshot.trialSkinId;
            if (!trialSkinId) return { applied: false, reason: 'invalidSnapshot' };
            this.pendingTrialSkinId = trialSkinId;
            return { applied: true, trialSkinId };
        }
        }
    }

    /** 新局开始时消费待生效的限时神通（供 GameCore.startRun({ startBuffs }) 注入） */
    consumeStartBuffs(): StartRunBuffs | null {
        const out = this.pendingBuffs;
        this.pendingBuffs = null;
        return out;
    }

    /**
     * 新局开始时推进试用皮肤生命周期：
     * - 若有待生效的试用皮肤 → 本局启用该试用皮肤
     * - 若上一局已用完试用皮肤 → 自动过期，返回 ownedSkinId
     */
    onRunStartSkin(ownedSkinId: string): string {
        if (this.pendingTrialSkinId) {
            this.activeTrialSkinId = this.pendingTrialSkinId;
            this.pendingTrialSkinId = null;
            return this.activeTrialSkinId;
        }
        this.activeTrialSkinId = null;
        return ownedSkinId;
    }

    /** 单局结束时结束当前局的试用皮肤（归还为已拥有皮肤） */
    onRunEndSkin(ownedSkinId: string): string {
        if (this.activeTrialSkinId !== null) {
            this.activeTrialSkinId = null;
            return ownedSkinId;
        }
        return this.pendingTrialSkinId ?? ownedSkinId;
    }
}
