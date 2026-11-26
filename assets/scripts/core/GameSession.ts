/**
 * GameSession —— 单局生命周期与成长经济业务协调器（Phase 8.2.2 / 8.2.8）。零 cc 依赖。
 *
 * 职责边界：
 * - 统一管理单局状态流转：title → running ⇄ paused → dying → awaitRevive → settled | journeyCleared
 * - 统一协调 GameCore、RunLedger、Economy、PlayerStats、DailyQuests、Achievements、Upgrades、
 *   Tutorial、AdRewardCoordinator 与 Save，彻底消除 Game.ts 中的业务膨胀
 * - 提供统一的奖励/购买/装备/领取/结算/备份恢复原子事务接口
 * - 纯 TypeScript，可在 Node 直接端到端测试全部玩法+成长+广告+存档闭环
 */
import { GameCore } from './GameCore';
import { RunLedger } from './RunLedger';
import { Economy } from './Economy';
import { PlayerStats } from './PlayerStats';
import { DailyQuests, QUEST_TEMPLATES } from './Quests';
import { Achievements, ACHIEVEMENTS } from './Achievements';
import { Upgrades, UpgradeKind, totalLevels } from './Upgrades';
import { Tutorial } from './Tutorial';
import { AdRewardCoordinator, AdRewardTicket, AdApplyOutcome } from './AdRewardCoordinator';
import { CoreCommand, CoreEvent, SessionState } from './types';
import { Save } from '../platform/Save';
import { DEFAULT_SKIN_ID, SKIN_COSTS } from '../config/SkinCatalog';
import type { AdScene } from '../platform/AdService';

export interface SessionTickResult {
    events: CoreEvent[];
    sessionState: SessionState;
    /** 本帧是否触发了结算 */
    settled: boolean;
    /** 本次结算是否为该局首次结算（用于决定是否触发插屏/局数统计） */
    isFirstSettle: boolean;
    /** 无尽最佳纪录是否更新 */
    bestLiUpdated: boolean;
    /** 若试用皮肤到期归还，返回新皮肤 id */
    revertedSkinId: string | null;
}

export interface GameSessionDeps {
    core: GameCore;
    save: Save;
    skinIds: string[];
    today: () => string;
}

export class GameSession {
    readonly core: GameCore;
    readonly save: Save;
    readonly ledger = new RunLedger();
    readonly adRewards = new AdRewardCoordinator();
    readonly ach = new Achievements();
    economy: Economy;
    stats: PlayerStats;
    quests: DailyQuests;
    upgrades: Upgrades;
    tutorial = new Tutorial(false);

    private readonly skinIds: string[];
    private readonly todayFn: () => string;
    private _state: SessionState = 'title';
    private tutorialRun = false;
    private activeSkinId: string;
    private sync = { totalLi: 0, totalFrags: 0, itemUses: {} as Record<string, number> };

    constructor(deps: GameSessionDeps) {
        this.core = deps.core;
        this.save = deps.save;
        this.skinIds = deps.skinIds.length ? [...deps.skinIds] : [DEFAULT_SKIN_ID];
        this.todayFn = deps.today;

        const d = this.save.data;
        this.economy = new Economy(d.gold, d.txLog);
        this.stats = new PlayerStats(d.stats);
        this.quests = new DailyQuests(d.quests, this.todayFn());
        this.save.data.quests = { ...this.quests.state };
        this.upgrades = new Upgrades(d.upgrades);
        if (!d.skinsOwned.includes(d.skin)) d.skin = DEFAULT_SKIN_ID;
        this.activeSkinId = d.skin;
        this.sync = { totalLi: 0, totalFrags: 0, itemUses: { ...this.stats.stats.itemUses } };
    }

    /** 当前单局会话状态（唯一真源） */
    get state(): SessionState { return this._state; }
    /** 当前视觉应展示的皮肤 id（含试用皮肤） */
    get currentSkinId(): string { return this.activeSkinId; }
    get isTutorialRun(): boolean { return this.tutorialRun; }
    get currentRunId(): number { return this.ledger.currentSeed; }

    /** 强化效果注入核心（五系全部生效，不含速度） */
    applyUpgradeMods(): void {
        this.core.mods = {
            staffCapBonus: this.upgrades.staffCapBonus(),
            waterReduceBonus: this.upgrades.waterReduceBonus(),
            magnetBonus: this.upgrades.magnetDurationBonus(),
            heatResist: this.upgrades.heatResist(),
            goldMul: this.upgrades.goldMul(),
        };
    }

    /** 启动新局（无尽/征途/教程）；统一处理单局种子、覆写、神通注入、试用皮肤与统计同步 */
    startRun(mode: 'endless' | 'journey', opts?: { tutorial?: boolean; seed?: number }): { runId: number; activeSkinId: string } {
        const tutorial = opts?.tutorial ?? false;
        if (this.tutorialRun && !tutorial) {
            this.tutorialRun = false;
            this.core.setRunOverrides(this.ledger.endTutorial());
        }
        this.tutorialRun = tutorial;
        this.tutorial = tutorial ? new Tutorial(true, 0) : new Tutorial(false);

        const { runId, overrides } = this.ledger.beginRun(tutorial);
        const startBuffs = this.adRewards.consumeStartBuffs();
        this.activeSkinId = this.adRewards.onRunStartSkin(this.save.data.skin);

        this.applyUpgradeMods();
        this.stats.onRunStart();
        this.quests.resetRunMetrics();
        this.sync = { totalLi: 0, totalFrags: 0, itemUses: { ...this.stats.stats.itemUses } };
        this.persist();

        this.core.startRun({
            seed: opts?.seed ?? runId,
            mode,
            overrides,
            startBuffs,
        });
        this._state = 'running';
        return { runId, activeSkinId: this.activeSkinId };
    }

    /** 返回主菜单：退出当前局、清除教程覆写、归还试用皮肤 */
    returnToTitle(): string {
        if (this.tutorialRun) {
            this.tutorialRun = false;
            this.core.setRunOverrides(this.ledger.endTutorial());
        }
        this.core.returnToTitle();
        this.activeSkinId = this.adRewards.onRunEndSkin(this.save.data.skin);
        this._state = 'title';
        return this.activeSkinId;
    }

    pause(): void {
        if (this._state !== 'running') return;
        this.core.pause();
        if (this.core.paused) this._state = 'paused';
    }

    resume(): void {
        if (this._state !== 'paused') return;
        this.core.resume();
        if (!this.core.paused) this._state = 'running';
    }

    onBackgroundHide(): void {
        if (this._state === 'running') this.pause();
    }

    onBackgroundResume(): void {
        this.core.onBackgroundResume();
    }

    /** 提交玩法输入命令 */
    submitCommand(cmd: CoreCommand, immediate = true): void {
        if (cmd.type === 'pause') { this.pause(); return; }
        if (cmd.type === 'resume') { this.resume(); return; }
        if (immediate) this.core.applyCommand(cmd);
        else this.core.enqueueCommand(cmd);
    }

    /** 单帧推进：驱动核心固定步长、喂数成长与任务系统、处理金币与单局结算 */
    tick(dtRaw: number): SessionTickResult {
        this.core.update(dtRaw);
        const events = this.core.drainEvents();

        // 统计/教程喂数
        this.stats.onEvents(events);
        this.tutorial.onEvents(events);
        this.tutorial.update(this.core);
        if (this.tutorialRun && this.tutorial.done) {
            if (!this.save.data.tutorial.done) this.save.data.tutorial.done = true;
            this.tutorialRun = false;
            this.core.setRunOverrides(this.ledger.endTutorial());
            this.persist();
        }

        // 领域事件驱动任务与主题访问
        for (const e of events) {
            if (e.type === 'themeChange' && e.themeIdx !== undefined) {
                this.stats.visitTheme(e.themeIdx);
                if (e.themeIdx % 4 === 2) this.quests.addProgress('themeDesert', 1);
            } else if (e.type === 'obstaclePassed') this.quests.addProgress('obstaclesPassed', 1);
            else if (e.type === 'obstacleSmashed' || e.type === 'staffBreak') this.quests.addProgress('obstaclesSmashed', 1);
            else if (e.type === 'turnOk') this.quests.addProgress('turns', 1);
            else if (e.type === 'cool') this.quests.addProgress('coolEvents', 1);
            else if (e.type === 'journeyDone') this.quests.addProgress('journeyDone', 1);
        }

        // 累计增量与单局峰值喂数
        const liRounded = Math.round(this.core.li);
        this.quests.addProgress('totalLi', Math.max(0, liRounded - this.sync.totalLi));
        this.sync.totalLi = liRounded;
        this.quests.addProgress('totalFrags', Math.max(0, this.core.frags - this.sync.totalFrags));
        this.sync.totalFrags = this.core.frags;
        const iu = this.stats.stats.itemUses;
        for (const k of ['dash', 'magnet', 'leap', 'shield', 'water', 'staff'] as const) {
            const cur = iu[k] ?? 0;
            const key = `use${k[0].toUpperCase()}${k.slice(1)}` as never;
            this.quests.addProgress(key, Math.max(0, cur - (this.sync.itemUses[k] ?? 0)));
            this.sync.itemUses[k] = cur;
        }
        this.quests.setRunMetric('runLi', liRounded);
        this.quests.setRunMetric('runFrags', this.core.frags);

        // 实时金币累计差额发放
        const grant = this.ledger.fragmentGrant(this.core.frags, this.upgrades.goldMul());
        if (grant && grant.amount > 0) this.economy.grant(grant.txId, grant.amount);

        // 同步核心状态到会话状态机并执行结算
        let settled = false;
        let isFirstSettle = false;
        let bestLiUpdated = false;
        let revertedSkinId: string | null = null;

        if (this.core.state === 'dying' && this._state === 'running') {
            this._state = 'dying';
        }
        for (const e of events) {
            if (e.type === 'died') {
                if (this.core.mode === 'endless') {
                    const li = Math.floor(this.core.li);
                    if (li > this.save.data.bestLi) {
                        this.save.data.bestLi = li;
                        bestLiUpdated = true;
                    }
                }
                this._state = this.core.reviveUsable() ? 'awaitRevive' : 'settled';
                const res = this.settleCurrentRun();
                settled = res.settled;
                isFirstSettle = res.isFirstSettle;
                revertedSkinId = res.revertedSkinId;
            } else if (e.type === 'journeyDone') {
                this.save.data.journeyDone = true;
                this._state = 'journeyCleared';
                const res = this.settleCurrentRun();
                settled = res.settled;
                isFirstSettle = res.isFirstSettle;
                revertedSkinId = res.revertedSkinId;
            }
        }

        return { events, sessionState: this._state, settled, isFirstSettle, bestLiUpdated, revertedSkinId };
    }

    private settleCurrentRun(): { settled: boolean; isFirstSettle: boolean; revertedSkinId: string | null } {
        const delta = this.ledger.claimSettlement(this.ledger.currentSeed, this.core.li, this.core.frags);
        if (!delta) return { settled: false, isFirstSettle: false, revertedSkinId: null };
        this.stats.onRunSettle(
            delta.deltaLi,
            delta.deltaFrags,
            delta.deltaGold,
            this.core.state,
            this.core.themeIdx,
            this.core.themeIdx,
            this.core.isCoolRun,
            this.core.li,
        );
        let revertedSkinId: string | null = null;
        if (!this.core.reviveUsable() || this.core.state === 'ended') {
            const reverted = this.adRewards.onRunEndSkin(this.save.data.skin);
            if (reverted !== this.activeSkinId) {
                this.activeSkinId = reverted;
                revertedSkinId = reverted;
            }
        }
        this.persist();
        return { settled: true, isFirstSettle: delta.isFirstSettle, revertedSkinId };
    }

    // ---------- 广告奖励事务 ----------
    prepareAdTicket(scene: AdScene): AdRewardTicket | null {
        return this.adRewards.prepareTicket(scene, {
            core: this.core,
            ledger: this.ledger,
            quests: this.quests,
            allSkinIds: this.skinIds,
            ownedSkins: this.save.data.skinsOwned,
            currentSkinId: this.save.data.skin,
        });
    }

    applyAdReward(ticket: AdRewardTicket): AdApplyOutcome {
        const outcome = this.adRewards.applyReward(ticket, {
            core: this.core,
            ledger: this.ledger,
            economy: this.economy,
            quests: this.quests,
            questClaimedStore: this.save.data.quests.claimed,
        });
        if (!outcome.applied) return outcome;
        if (ticket.scene === 'revive') {
            this._state = 'running';
        } else if (ticket.scene === 'skinTrial' && outcome.trialSkinId) {
            this.activeSkinId = outcome.trialSkinId;
        }
        this.persist();
        return outcome;
    }

    // ---------- 成长与经济原子事务（零 cc 依赖，可独立单测） ----------
    claimQuest(questId: string): number {
        const tpl = QUEST_TEMPLATES.find((t) => t.id === questId);
        if (!tpl || !this.quests.isComplete(tpl) || this.quests.isClaimed(tpl)) return 0;
        if (!this.quests.claim(tpl, this.save.data.quests.claimed)) return 0;
        const granted = this.economy.grant(`q:${this.quests.state.date}:${tpl.id}`, tpl.reward);
        this.persist();
        return granted;
    }

    claimAchievement(achId: string): number {
        const def = ACHIEVEMENTS.find((a) => a.id === achId);
        if (!def) return 0;
        const extra = { skins: this.save.data.skinsOwned.length, upgradeLevels: totalLevels(this.upgrades.levels) };
        if (!this.ach.isUnlocked(def, this.stats.stats, extra) || this.ach.isClaimed(def, this.save.data.achClaimed)) return 0;
        if (!this.ach.claim(def, this.save.data.achClaimed)) return 0;
        const granted = this.economy.grant(`a:${def.id}`, def.reward);
        this.persist();
        return granted;
    }

    buySkin(skinId: string): boolean {
        if (!this.skinIds.includes(skinId)) return false;
        if (this.save.data.skinsOwned.includes(skinId)) return false;
        const cost = SKIN_COSTS[skinId];
        if (cost === undefined || cost < 0) return false;
        if (cost > 0 && !this.economy.spend(cost)) return false;
        this.save.data.skinsOwned.push(skinId);
        this.save.data.skin = skinId;
        this.activeSkinId = skinId;
        this.persist();
        return true;
    }

    equipSkin(skinId: string): boolean {
        if (!this.skinIds.includes(skinId) || !this.save.data.skinsOwned.includes(skinId)) return false;
        this.save.data.skin = skinId;
        this.activeSkinId = skinId;
        this.persist();
        return true;
    }

    cycleOwnedSkin(): string | null {
        const owned = this.save.data.skinsOwned;
        if (!owned.length) return null;
        const curPos = owned.indexOf(this.save.data.skin);
        const nextId = owned[(curPos + 1 + owned.length) % owned.length];
        this.save.data.skin = nextId;
        this.activeSkinId = nextId;
        this.persist();
        return nextId;
    }

    buyUpgrade(kind: UpgradeKind): boolean {
        const cost = this.upgrades.cost(kind);
        if (cost === null || !this.economy.spend(cost)) return false;
        this.upgrades.apply(kind);
        this.applyUpgradeMods();
        this.persist();
        return true;
    }

    restoreBackup(): boolean {
        if (!this.save.restoreBackup()) return false;
        const d = this.save.data;
        this.economy = new Economy(d.gold, d.txLog);
        this.stats = new PlayerStats(d.stats);
        this.quests = new DailyQuests(d.quests, this.todayFn());
        this.save.data.quests = { ...this.quests.state };
        this.upgrades = new Upgrades(d.upgrades);
        this.applyUpgradeMods();
        this.sync = { totalLi: 0, totalFrags: 0, itemUses: { ...this.stats.stats.itemUses } };
        this.activeSkinId = d.skin;
        return true;
    }

    persist(): boolean {
        this.save.data.gold = this.economy.gold;
        this.save.data.txLog = this.economy.exportTxLog();
        this.save.data.quests = { ...this.quests.state };
        this.save.data.stats = this.stats.stats;
        this.save.data.upgrades = { ...this.upgrades.levels };
        return this.save.flush();
    }
}
