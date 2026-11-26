/**
 * 逐日 · 夸父逐日神话跑酷 —— 引导层。
 * 职责仅装配：加载配置 → 构建 核心/输入/渲染/广告 → 每帧驱动与事件路由。
 * 玩法规则全部在 core/GameCore；画面在 render/*；平台在 platform/*。
 */
import { _decorator, Component, Color, error, game, Game as CCGame } from 'cc';
import { loadGameConfig, loadObstacleCatalog, loadSkins, loadTileTemplates } from './config/GameConfig';
import { SkinCatalog } from './config/SkinCatalog';
import { formatUi, GameConfig } from './config/GameConfigSchema';
import { GameCore } from './core/GameCore';
import { Logger } from './core/Logger';
import { Intent } from './core/types';
import { InputController, InputDelegate } from './input/InputController';
import { Hud2D, HudButton } from './render/Hud2D';
import { IRenderer } from './render/IRenderer';
import { Renderer2D } from './render/Renderer2D';
import { Renderer3D } from './render/Renderer3D';
import { AdService, AdScene } from './platform/AdService';
import { createPlatform } from './platform/PlatformFactory';
import { MockRewardedAdapter, MockInterstitialAdapter } from './platform/mock/MockAdAdapter';
import { installGlobalErrorHooks } from './platform/ErrorHooks';
import { Save, defaultSaveData } from './platform/Save';
import { AudioMgr, SfxName } from './audio/AudioMgr';
import { LOGICAL_W, PLAYER_Y } from './render/layout';
import { Economy } from './core/Economy';
import { PlayerStats } from './core/PlayerStats';
import { RunLedger } from './core/RunLedger';
import { DailyQuests, QUEST_TEMPLATES } from './core/Quests';
import { Achievements, ACHIEVEMENTS } from './core/Achievements';
import { Upgrades, UpgradeKind, UPGRADE_DEFS, totalLevels } from './core/Upgrades';
import { Tutorial } from './core/Tutorial';

const { ccclass } = _decorator;
const log = new Logger('Game');

/** 原子消费辅助：Economy.spend 透传 */
@ccclass('Game')
export class Game extends Component {
    private cfg: GameConfig | null = null;
    private core: GameCore | null = null;
    private hud: Hud2D | null = null;
    private renderer: IRenderer | null = null;
    private inputCtl: InputController | null = null;
    private ad: AdService | null = null;
    private platform!: ReturnType<typeof createPlatform>;
    private catalog: import('./config/ObstacleCatalog').ObstacleCatalog | null = null;
    private skins: SkinCatalog | null = null;
    private save: Save | null = null;
    private audio: AudioMgr | null = null;
    private skinIdx = 0;
    // ---- Phase 6 成长系统 ----
    economy = new Economy();
    stats = new PlayerStats(defaultSaveData().stats);
    quests = new DailyQuests(defaultSaveData().quests, '1970-01-01');
    ach = new Achievements();
    upgrades = new Upgrades({});
    tutorial = new Tutorial(false);
    page: string | null = null;
    private ledger = new RunLedger();
    private lastThemeIdx = 0;
    private sync = { totalLi: 0, totalFrags: 0, itemUses: {} as Record<string, number> };
    private tutorialRun = false;
    private lifecycleDispose: (() => void) | null = null;

    async start() {
        installGlobalErrorHooks();
        let cfg: GameConfig;
        let catalog;
        let skins;
        let tiles;
        try {
            // 数据源加载：玩法配置 + 障碍/道具目录 + 皮肤目录 + 地块模板（非法均抛错拒绝启动）
            [cfg, catalog, skins, tiles] = await Promise.all([
                loadGameConfig(), loadObstacleCatalog(), loadSkins(), loadTileTemplates(),
            ]);
        } catch (e) {
            error('[Game] 配置加载失败，游戏无法启动: ' + String(e));
            log.error('配置加载失败，游戏无法启动', String(e));
            throw e;
        }
        this.catalog = catalog;
        this.skins = skins;
        this.core = this.core ?? new GameCore(cfg, undefined, { turnsEnabled: cfg.renderMode === '3d', catalog });
        // 无限地图：注入地块模板 id 表（渲染装饰由模板数据驱动）
        this.core.mapGen.tileIds = tiles.templates.map((t) => ({ id: t.id, kind: t.kind, theme: t.theme }));
        // 平台服务与生命周期（存档必须走平台抽象：微信 API / 浏览器内存兜底）
        this.platform = createPlatform();
        const lc = this.platform.lifecycle({ onHide: () => this.onGameHide(), onShow: () => this.onGameShow() });
        if (!lc.supported) log.warn('平台生命周期不支持: ' + (lc.reason ?? '未知'));
        this.lifecycleDispose = lc.dispose ?? null;
        this.save = new Save(this.platform.storage);
        // Phase 6：存档装载到各成长系统（迁移/损坏处理已由 Save 完成）
        this.economy = new Economy(this.save.data.gold, this.save.data.txLog);
        this.stats = new PlayerStats(this.save.data.stats);
        this.quests = new DailyQuests(this.save.data.quests, this.today());
        this.upgrades = new Upgrades(this.save.data.upgrades);
        this.skinIdx = Math.max(0, this.save.data.skinsOwned.indexOf(this.save.data.skin));
        if (this.save.data.skinsOwned.indexOf(this.save.data.skin) < 0) {
            this.save.data.skin = 'kuafu';
            this.skinIdx = 0;
        }
        this.audio = new AudioMgr(this.node);
        // 启动即恢复存档静音状态（此前从不恢复：上次静音本次照响）；默认静音见 Save 默认值
        this.audio.setMuted(this.save.data.settings.muted);
        void this.audio.load();
        log.info('配置加载成功 renderMode=' + cfg.renderMode + ' 障碍种类=' + catalog.obstacles.length);
        this.cfg = cfg;
        // 广告（正式隔离：微信端只走平台适配器，mock 模式在微信端不发奖）
        // ad.enabled=false 为可玩性测试期总开关：全部场景明确不可用，HUD 同步隐藏入口
        const mockRewarded = this.platform.isWechat ? undefined : new MockRewardedAdapter();
        const mockInterstitial = this.platform.isWechat ? undefined : new MockInterstitialAdapter();
        this.ad = new AdService(this.platform, {
            enabled: cfg.ad.enabled,
            mode: cfg.ad.mode,
            timeoutMs: cfg.ad.timeoutMs,
            adUnitIds: cfg.ad.adUnitIds,
            interstitialUnitId: cfg.ad.interstitialUnitId,
            interstitial: cfg.ad.interstitial,
        }, this.save.data.ads, mockRewarded, mockInterstitial);
        // 2D 渲染器需先于 Hud2D 创建节点，保证 UI 绘制在世界之上
        if (cfg.renderMode === '2d') this.renderer = new Renderer2D(this.node, cfg, catalog);
        this.hud = new Hud2D(this.node, cfg);
        if (this.save) {
            this.hud.setBestLi(this.save.data.bestLi);
            this.hud.syncMuted(this.save.data.settings.muted);
        }
        if (cfg.renderMode === '3d') {
            const r3d = new Renderer3D(cfg, catalog);
            r3d.setTileTemplates(tiles.templates);   // 42 模板驱动渲染装饰（此前从未接线）
            this.renderer = r3d;
        }
        this.inputCtl = new InputController(this.makeDelegate(), cfg.input);
        this.inputCtl.attach();
        this.hud.setHandlers({
            onPageAction: (action: string) => this.onPageAction(action),
            onTutorialSkip: () => this.tutorial.skip(),
            onNavPage: (page: string) => {
                if (this.core?.state !== 'title') return;
                if (page === 'tutorial') { this.startTutorial(); return; }
                this.page = page;
                this.refreshPage();
            },
        });
        // 退后台自动暂停（微信 onHide / 浏览器切页），回到前台由玩家手动恢复
        game.on(CCGame.EVENT_HIDE, this.onGameHide, this);
        log.info('装配完成');
    }

    onDestroy() {
        this.inputCtl?.detach();
        this.renderer?.destroy();
        this.audio?.destroy();
        this.ad?.dispose();
        this.lifecycleDispose?.();
        game.off(CCGame.EVENT_HIDE, this.onGameHide, this);
    }

    private onGameHide() {
        this.ad?.onHide();
        if (this.core && this.core.state === 'run' && !this.core.paused) {
            this.core.pause();
            log.info('切后台自动暂停');
        }
    }

    update(dtRaw: number) {
        if (!this.core || !this.renderer || !this.hud || !this.ad) return;
        this.core.update(dtRaw);
        const events = this.core.drainEvents();
        // Phase 6：成长系统喂数（统计/任务进度/教程推进）
        this.stats.onEvents(events);
        this.tutorial.onEvents(events);
        this.tutorial.update(this.core);
        if (this.tutorialRun && this.tutorial.done) {
            if (this.save && !this.save.data.tutorial.done) this.save.data.tutorial.done = true;
            this.tutorialRun = false;
            this.ledger.endTutorial(this.core.cfg.spawn, this.core.cfg.map);
            this.persist();
        }
        const themeIdx = this.core.themeIdx;
        if (themeIdx !== this.lastThemeIdx) {
            if (themeIdx > this.lastThemeIdx) this.stats.visitTheme(themeIdx);
            this.lastThemeIdx = themeIdx;
        }
        // 任务累计/峰值喂数（按累计值增量，dt 无关）
        this.quests.addProgress('totalLi', Math.max(0, Math.round(this.core.li) - this.sync.totalLi));
        this.sync.totalLi = Math.round(this.core.li);
        this.quests.addProgress('totalFrags', Math.max(0, this.core.frags - this.sync.totalFrags));
        this.sync.totalFrags = this.core.frags;
        const iu = this.stats.stats.itemUses;
        for (const k of ['dash', 'magnet', 'leap', 'shield', 'water', 'staff'] as const) {
            const cur = iu[k] ?? 0;
            const key = `use${k[0].toUpperCase()}${k.slice(1)}` as never;
            this.quests.addProgress(key, Math.max(0, cur - (this.sync.itemUses[k] ?? 0)));
            this.sync.itemUses[k] = cur;
        }
        this.quests.setRunMetric('runLi', Math.round(this.core.li));
        this.quests.setRunMetric('runFrags', this.core.frags);
        // 金币：实时增量发放，事务 id 由 RunLedger 保证跨局唯一
        const grant = this.ledger.fragmentGrant(this.core.frags, this.upgrades.goldMul());
        if (grant && grant.amount > 0) this.economy.grant(grant.txId, grant.amount);
        // 结算：死亡/通关瞬间（每局一次）+ 最佳纪录 + 征途标记
        for (const e of events) {
            if (e.type === 'died' && this.core.mode === 'endless') {
                const li = Math.floor(this.core.li);
                if (this.save && li > this.save.data.bestLi) {
                    this.save.data.bestLi = li;
                    this.hud?.setBestLi(li);
                }
                this.settleRun();
            }
            if (e.type === 'journeyDone') {
                if (this.save) this.save.data.journeyDone = true;
                this.settleRun();
            }
        }
        this.routeEvents(events);
        this.hud.update(dtRaw, this.core);
        this.renderer.onCoreEvents(events);
        this.renderer.render(this.core, this.ad, dtRaw, this.hud);
        this.playRunSfx(events);
    }

    /** 奔跑/事件音效（独立于视觉路由） */
    private playRunSfx(events: ReturnType<GameCore['drainEvents']>) {
        const core = this.core!;
        // 脚步：runPhase 每 π 一步（与四肢摆动同步，避免脚步滑动）
        if (core.state === 'run' && !core.paused) {
            const step = Math.floor(core.runPhase / Math.PI);
            if (step !== this.lastStep) {
                this.lastStep = step;
                this.audio?.playSfx(step % 2 === 0 ? 'footstep_a' : 'footstep_b', 0.5);
            }
        }
        for (const e of events) {
            switch (e.type) {
            case 'crash': this.audio?.playSfx('hit'); break;
            case 'died': this.audio?.playSfx('death'); break;
            case 'fragment': this.audio?.playSfx('coin', 0.6); break;
            case 'land': this.audio?.playSfx('land', 0.7); break;
            case 'jump': this.audio?.playSfx('jump', 0.8); break;
            case 'slideStart': this.audio?.playSfx('slide', 0.8); break;
            case 'turnOk': this.audio?.playSfx('turn'); break;
            case 'shieldBreak': this.audio?.playSfx('shield'); break;
            case 'stumble': this.audio?.playSfx('hit', 0.8); break;
            default: break;
            }
        }
    }
    private lastStep = -1;

    /** 核心事件路由：弹字走 HUD（特效事件由渲染器自行消费） */
    private routeEvents(events: ReturnType<GameCore['drainEvents']>) {
        const hud = this.hud!;
        const amber = new Color(255, 209, 102, 255);
        const main = new Color(255, 207, 125, 255);
        for (const e of events) {
            if (e.type === 'fragment') {
                const lane = e.lane ?? 0;
                hud.showPop(LOGICAL_W / 2 + lane * 60, PLAYER_Y - 130, '+1', false, amber);
            } else if (e.type === 'milestone') {
                hud.showPop(LOGICAL_W / 2, 250, formatUi(this.cfg!.ui.milestoneText, e.n ?? 0), true, main);
            } else if (e.type === 'stumble') {
                hud.showPop(LOGICAL_W / 2, 320, this.cfg!.ui.stumbleText, true, new Color(255, 122, 82, 255));
            } else if (e.type === 'item') {
                const def = this.catalog?.items.find((x) => x.id === e.kind);
                hud.showPop(LOGICAL_W / 2 + (e.lane ?? 0) * 60, PLAYER_Y - 170, def?.label ?? String(e.kind), true, new Color(120, 200, 255, 255));
                // 神通音效（道具种类 → 音效名）
                const sfxMap: Partial<Record<string, SfxName>> = {
                    magnet: 'magnet', shield: 'shield', dash: 'dash', double: 'double',
                    water: 'water', staff: 'leap', leap: 'leap',
                };
                const sfx = sfxMap[String(e.kind)];
                if (sfx) this.audio?.playSfx(sfx);
            } else if (e.type === 'shieldBreak') {
                hud.showPop(LOGICAL_W / 2, 300, '护盾抵挡！', true, new Color(255, 213, 74, 255));
                this.audio?.playSfx('shield');
            } else if (e.type === 'water') {
                hud.showPop(LOGICAL_W / 2, 300, '神泉饮 · 复振', true, new Color(64, 208, 192, 255));
                this.audio?.playSfx('water');
            } else if (e.type === 'staffBreak') {
                hud.showPop(LOGICAL_W / 2, 300, '桃木神杖 · 破！', true, new Color(184, 122, 62, 255));
                this.audio?.playSfx('staff');
            } else if (e.type === 'cool') {
                hud.showPop(LOGICAL_W / 2 + (e.lane ?? 0) * 60, PLAYER_Y - 160, `清凉 −${e.amount}`, false, new Color(64, 208, 192, 255));
            } else if (e.type === 'stage') {
                hud.showPop(LOGICAL_W / 2, 280, e.label ?? '', true, new Color(255, 224, 160, 255));
                this.audio?.playSfx('pity');
            } else if (e.type === 'journeyDone') {
                // 通关由 ended 面板呈现
            }
        }
    }

    /** 应用当前皮肤（3D 角色重建） */
    private applySkin() {
        if (!this.skins || !this.renderer?.applySkin) return;
        const skin = this.skins.skins[this.skinIdx % this.skins.skins.length];
        this.renderer.applySkin(skin);
    }

    /** 换肤循环（标题页按钮）：写存档 + 3D 重建 + HUD 更新 */
    private cycleSkin() {
        if (!this.skins || !this.save) return;
        this.skinIdx = (this.skinIdx + 1) % this.skins.skins.length;
        this.save.data.skin = this.skins.skins[this.skinIdx].id;
        this.persist();
        this.applySkin();
        this.hud?.setSkinIdx(this.skinIdx, this.skins.skins.map((x) => x.label));
        this.audio?.playSfx('ui');
    }

    /** 单局结算：统计落账、插屏（仅自然结束节点）、存档落盘。金币已在拾取时逐笔发放，此处不重复 grant。 */
    private settleRun() {
        const core = this.core!;
        if (!this.ledger.claimSettlement(this.ledger.currentSeed)) return;
        const gold = Math.round(core.frags * this.upgrades.goldMul());
        this.stats.onRunSettle(core.li, core.frags, gold, core.state, core.themeIdx, core.themeIdx);
        this.ad?.stats.record('run_end', core.mode);
        this.ad?.noteRunEnd();
        // 插屏：仅在自然结算节点尝试（内部总开关/首局保护/冷却/频控）绝不打断奔跑
        this.ad?.maybeShowInterstitial();
        this.persist();
    }

    /** 所有持久状态的统一写盘入口：金币/事务日志/任务/成长/广告统计必须与存档同源 */
    private persist(): void {
        if (!this.save) return;
        this.save.data.gold = this.economy.gold;
        this.save.data.txLog = this.economy.exportTxLog();
        this.save.data.quests = { ...this.quests.state };
        this.save.data.stats = this.stats.stats;
        this.save.data.upgrades = { ...this.upgrades.levels };
        if (this.ad) this.save.data.ads = this.ad.stats.data;
        try { this.save.flush(); }
        catch (e) { log.warn('存档写入失败（游戏继续运行）', String(e)); }
    }

    /**
     * 广告请求（5 场景）：死亡复活/结算翻倍/每日奖励翻倍/限时神通/皮肤试用。
     * 仅 AdService 判定 isEnded=true 且事务未结算时才发奖；失败不阻断游戏。
     */
    private requestAd(scene: AdScene): void {
        if (!this.ad || !this.save || !this.core) return;
        if (scene === 'revive' && (!this.core.reviveUsable() || this.core.state !== 'dead')) return;
        const check = this.ad.canUse(scene);
        if (!check.ok) {
            // 明确不可用（未开通流量主/未配置广告位）——不伪造成功，不阻断游戏
            this.hud?.showPop(LOGICAL_W / 2, 300, '广告暂不可用', false, new Color(255, 122, 106, 255));
            return;
        }
        void this.ad.requestReward(scene, () => {
            // ★ 回调只在此处发放一次（AdService 事务已防重放）
            switch (scene) {
            case 'revive':
                if (!this.core!.revive()) break;   // 异步回调到达时状态可能已变
                    this.ad!.stats.record('revive', scene);
                this.audio?.playSfx('revive');
                break;
            case 'doubleCoins': {
                const bonus = Math.round(this.core!.frags * this.upgrades.goldMul());
                this.economy.grant(`addouble:${Date.now()}`, bonus);
                this.hud?.showPop(LOGICAL_W / 2, 300, `金币 ×2 +${bonus}`, true, new Color(255, 209, 102, 255));
                break;
            }
            case 'dailyDouble': {
                // 今日最优任务的奖励翻倍（事务幂等）
                const tpl = this.quests.todays().find((t) => this.quests.isComplete(t) && !this.quests.isClaimed(t));
                if (tpl && this.quests.claim(tpl, this.save!.data.quests.claimed)) {
                    this.economy.grant(`addaily:${this.quests.state.date}:${tpl.id}`, tpl.reward * 2);
                    this.refreshPage();
                }
                break;
            }
            case 'timedPower':
                    // 下一局限时神通：磁吸+冲刺（不入存档，单次有效）
                    this.core!.magnetT = Math.max(this.core!.magnetT, 12);
                    this.core!.dashT = Math.max(this.core!.dashT, 3);
                this.hud?.showPop(LOGICAL_W / 2, 300, '限时神通 · 获赠！', true, new Color(120, 200, 255, 255));
                break;
            case 'skinTrial': {
                // 指定皮肤试用：本局下一皮肤（不改存档拥有权）
                const next = (this.skinIdx + 1) % (this.skins?.skins.length ?? 1);
                this.skinIdx = next;
                this.applySkin();
                this.hud?.setSkinIdx(next, this.skins?.skins.map((x) => x.label) ?? []);
                this.hud?.showPop(LOGICAL_W / 2, 300, '皮肤试用 · 已启用', true, new Color(255, 207, 125, 255));
                break;
            }
            }
            this.persist();
        });
    }

    /** 回到前台：平台音频恢复（不影响暂停状态，由玩家手动继续） */
    private onGameShow() {
        this.ad?.onShow();
        const res = this.platform.resumeAudio();
        if (!res.supported) log.warn('音频恢复不可用: ' + (res.reason ?? ''));
    }

    /** 新手教程启动：稀疏生成 + 顺序引导（可跳过；参数由 RunLedger 备份并在结束后还原） */
    private startTutorial() {
        if (!this.core || !this.save) return;
        this.tutorialRun = true;
        this.tutorial = new Tutorial(true, 0);
        this.startMode('endless', true);
        this.hud?.showTutorialHint(this.tutorial.step?.text ?? '', !this.save.data.tutorial.done);
    }

    private today(): string {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    /** 按模式启动；记录模式（core.mode 影响征途判定与太阳进度） */
    private startMode(mode: 'endless' | 'journey', tutorial = false) {
        const core = this.core!;
        this.closePage();
        if (this.tutorialRun && !tutorial) {
            this.tutorialRun = false;
            this.ledger.endTutorial(core.cfg.spawn, core.cfg.map);
        }
        this.ledger.beginRun(core.cfg.spawn, core.cfg.map, tutorial);
        this.applyMods();
        this.stats.onRunStart();
        this.quests.resetRunMetrics();
        this.sync = { totalLi: 0, totalFrags: 0, itemUses: {} };
        this.lastStep = -1;
        this.ad?.stats.record('run_start', mode);
        this.persist();
        core.mode = mode;
        core.startRun();
    }

    /** 强化效果注入核心（五系全部生效，公平性：不含速度） */
    private applyMods(): void {
        const core = this.core!;
        core.mods = {
            staffCapBonus: this.upgrades.staffCapBonus(),
            waterReduceBonus: this.upgrades.waterReduceBonus(),
            magnetBonus: this.upgrades.magnetDurationBonus(),
            heatResist: this.upgrades.heatResist(),
            goldMul: this.upgrades.goldMul(),
        };
    }

    private makeDelegate(): InputDelegate {
        return {
            onGesture: (intent: Intent) => {
                if (!this.core || this.ad?.state === 'showing') return;   // 广告展示期吞掉手势
                this.hud?.markFirstInput();
                switch (intent) {
                case Intent.LaneLeft: this.core.doLane(-1); break;
                case Intent.LaneRight: this.core.doLane(1); break;
                case Intent.Jump: this.core.doJump(); break;
                case Intent.Slide: this.core.doSlide(); break;
                }
            },
            onTap: (gx: number, gy: number) => {
                if (!this.core || !this.hud || this.ad?.state === 'showing') return;
                const btn = this.hud.hitTestButtons(gx, gy, this.core);
                if (btn) this.onButton(btn);
                else if (this.core.state === 'run') this.core.doJump();
            },
            onTapStart: (gx: number, gy: number) => {
                if (!this.core || !this.hud || this.ad?.state === 'showing') return;
                if (gx > 408 && gx < 446 && gy > 20 && gy < 62) { const m = this.hud.toggleMute(); this.audio?.setMuted(m); return; }
                if (this.hud.hitTutorialSkip(gx, gy)) { this.tutorial.skip(); this.hud.hideTutorialHint(); return; }
                if (this.core.state === 'title' && this.hud.hitSkinButton(gx, gy)) this.cycleSkin();
                // 页面命中（任务领取/商店购买/强化升级/返回）
                if (this.page) {
                    const action = this.hud.pageTap(gx, gy);
                    if (action === '__back__') this.closePage();
                    else if (action) this.onPageAction(action);
                    return;
                }
                // 标题导航（功能页/教程）
                if (this.core.state === 'title') {
                    const nav = this.hud.hitNavButton(gx, gy);
                    if (nav === 'tutorial') { this.startTutorial(); return; }
                    if (nav) { this.page = nav; this.refreshPage(); return; }
                }
            },
            onActionStart: () => {
                if (this.core && this.core.state === 'title') this.startMode('endless');
            },
            onActionPause: () => {
                if (!this.core) return;
                if (this.core.state === 'run') {
                    if (this.core.paused) this.core.resume();
                    else this.core.pause();
                }
            },
        };
    }

    /** 页面交互：领取/购买/使用/升级/设置/广告奖励（幂等由 Economy/quests.claimed 保证） */
    private onPageAction(action: string): void {
        if (action === '__back__') { this.closePage(); return; }
        if (action.startsWith('ad:')) {
            this.requestAd(action.slice(3) as AdScene);
            return;
        }
        // 任务领取
        if (action.startsWith('claimq:')) {
            const id = action.slice(7);
            const tpl = QUEST_TEMPLATES.find((t) => t.id === id);
            if (!tpl || !this.quests.isComplete(tpl) || this.quests.isClaimed(tpl)) return;
            if (this.quests.claim(tpl, this.save?.data.quests.claimed ?? [])) {
                this.economy.grant(`q:${this.quests.state.date}:${tpl.id}`, tpl.reward);
                this.persist();
                this.refreshPage();
                this.audio?.playSfx('coin');
            }
            return;
        }
        // 成就领取
        if (action.startsWith('claima:')) {
            const id = action.slice(7);
            const def = ACHIEVEMENTS.find((a) => a.id === id);
            if (!def || !this.save) return;
            const extra = { skins: this.save.data.skinsOwned.length, upgradeLevels: totalLevels(this.upgrades.levels) };
            if (!this.ach.isUnlocked(def, this.save.data.stats, extra) || this.ach.isClaimed(def, this.save.data.achClaimed)) return;
            if (this.ach.claim(def, this.save.data.achClaimed)) {
                this.economy.grant(`a:${def.id}`, def.reward);
                this.persist();
                this.refreshPage();
                this.audio?.playSfx('coin');
            }
            return;
        }
        // 皮肤购买/使用
        if (action.startsWith('buy:') || action.startsWith('use:')) {
            const id = action.slice(4);
            if (!this.skins || !this.save) return;
            const skin = this.skins.skins.find((x) => x.id === id);
            if (!skin) return;
            if (action.startsWith('buy:')) {
                const costs: Record<string, number> = { xuanjia: 600, chiyan: 800, cangteng: 800, jinwu: 1200, weishui: 1000, huangmo: 1000, fusang: 2000 };
                if (this.save.data.skinsOwned.includes(id) || !this.economy.spend(costs[id] ?? 9999)) return;
                this.save.data.skinsOwned.push(id);
            }
            this.save.data.skin = id;
            this.skinIdx = Math.max(0, this.skins.skins.findIndex((x) => x.id === id));
            this.persist();
            this.applySkin();
            this.hud?.setSkinIdx(this.skinIdx, this.skins.skins.map((x) => x.label));
            this.refreshPage();
            this.audio?.playSfx('ui');
            return;
        }
        // 强化升级
        if (action.startsWith('up:')) {
            const kind = action.slice(3) as UpgradeKind;
            const cost = this.upgrades.cost(kind);
            if (cost === null || !this.economy.spend(cost)) return;
            this.upgrades.apply(kind);
            this.applyMods();
            this.persist();
            this.refreshPage();
            this.audio?.playSfx('ui');
            return;
        }
        // 设置
        if (action === 'restore') {
            if (this.save?.restoreBackup()) {
                // 备份是整份存档：所有派生系统必须重新装载，否则内存态仍指向旧档
                const d = this.save.data;
                this.economy = new Economy(d.gold, d.txLog);
                this.stats = new PlayerStats(d.stats);
                this.quests = new DailyQuests(d.quests, this.today());
                this.upgrades = new Upgrades(d.upgrades);
                this.applyMods();
                this.ad?.loadStats(d.ads);
                this.skinIdx = Math.max(0, d.skinsOwned.indexOf(d.skin));
                this.applySkin();
                this.hud?.setSkinIdx(this.skinIdx, this.skins?.skins.map((x) => x.label) ?? []);
                this.refreshPage();
                this.audio?.playSfx('ui');
            }
            return;
        }
        if (action === 'retutorial') {
            if (this.save) { this.save.data.tutorial.done = false; this.persist(); }
            this.closePage();
            this.audio?.playSfx('ui');
        }
    }

    private closePage(): void {
        this.page = null;
        this.hud?.closePage();
    }

    /** 刷新当前页内容 */
    private refreshPage(): void {
        if (!this.page || !this.save || !this.skins || !this.core) return;
        const d = this.save.data;
        const goldLbl = `灵光金币 ${this.economy.gold}`;
        if (this.page === 'quests') {
            const rows: { label: string; action?: string }[] = [{ label: goldLbl }];
            for (const t of this.quests.todays()) {
                const prog = this.quests.progressOf(t);
                const done = this.quests.isComplete(t);
                const claimed = d.quests.claimed.includes(t.id);
                rows.push({
                    label: `${t.label}  ${prog}/${t.goal}  ${claimed ? '已领' : done ? `【领取 ${t.reward}】` : ''}`,
                    action: done && !claimed ? `claimq:${t.id}` : undefined,
                });
            }
            this.hud?.openPage('quests', '每日任务', rows);
        } else if (this.page === 'achievements') {
            const extra = { skins: d.skinsOwned.length, upgradeLevels: totalLevels(this.upgrades.levels) };
            const rows: { label: string; action?: string }[] = [{ label: goldLbl }];
            const unlocked = this.ach.unlockedList(d.stats, extra).filter((a) => !this.ach.isClaimed(a, d.achClaimed));
            rows.push({ label: `已解锁 ${this.ach.unlockedList(d.stats, extra).length}/${ACHIEVEMENTS.length}` });
            for (const a of unlocked.slice(0, 7)) {
                rows.push({ label: `${a.label}  【领取 ${a.reward}】`, action: `claima:${a.id}` });
            }
            if (!unlocked.length) rows.push({ label: '暂无可领取成就（继续奔跑解锁）' });
            this.hud?.openPage('achievements', '成就', rows);
        } else if (this.page === 'shop') {
            const rows: { label: string; action?: string }[] = [{ label: goldLbl }, { label: '— 皮肤（点击购买/使用）—' }];
            for (const sk of this.skins.skins) {
                const owned = d.skinsOwned.includes(sk.id);
                rows.push({
                    label: owned ? (d.skin === sk.id ? `${sk.label} ✓使用中` : `${sk.label} 【使用】`) : `${sk.label} 【购买】`,
                    action: d.skin === sk.id ? undefined : owned ? `use:${sk.id}` : `buy:${sk.id}`,
                });
            }
            this.hud?.openPage('shop', '皮肤商店', rows);
        } else if (this.page === 'upgrades') {
            const rows: { label: string; action?: string }[] = [{ label: goldLbl }];
            for (const def of UPGRADE_DEFS) {
                const lv = this.upgrades.level(def.kind);
                const cost = this.upgrades.cost(def.kind);
                rows.push({
                    label: cost === null ? `${def.label} Lv${lv} 已满级` : `${def.label} Lv${lv}  ${def.desc(lv + 1)}  【${cost} 升级】`,
                    action: cost === null ? undefined : `up:${def.kind}`,
                });
            }
            this.hud?.openPage('upgrades', '能力强化', rows);
        } else if (this.page === 'records') {
            const st = d.stats;
            this.hud?.openPage('records', '个人纪录', [
                { label: `无尽最佳 ${d.bestLi} 里` },
                { label: `累计 ${Math.floor(st.totalLi)} 里 / ${st.runs} 局` },
                { label: `累计阳炎 ${st.totalFrags}` },
                { label: `路口通过 ${st.turns}` },
                { label: `击碎障碍 ${st.obstaclesSmashed}` },
                { label: `累计金币 ${st.goldEarned}` },
                { label: `征途 ${d.journeyDone ? '已完成' : '未完成'}` },
            ]);
        } else if (this.page === 'adrewards') {
            const available = (s: AdScene) => this.ad?.canUse(s).ok ? '【观看】' : '（暂不可用）';
            this.hud?.openPage('adrewards', '广告奖励', [
                { label: goldLbl },
                { label: `金币翻倍 ${available('doubleCoins')}`, action: 'ad:doubleCoins' },
                { label: `每日任务翻倍 ${available('dailyDouble')}`, action: 'ad:dailyDouble' },
                { label: `限时神通 ${available('timedPower')}`, action: 'ad:timedPower' },
                { label: `皮肤试用 ${available('skinTrial')}`, action: 'ad:skinTrial' },
                { label: '复活奖励在死亡面板领取' },
            ]);
        } else if (this.page === 'settings') {
            this.hud?.openPage('settings', '设置', [
                { label: this.hud?.isMutedVisual ? '声音 已静音' : '声音 开启' },
                { label: '恢复备份存档', action: 'restore' },
                { label: '重看新手教程', action: 'retutorial' },
            ]);
        }
    }

    private onButton(btn: HudButton) {
        const core = this.core!;
        switch (btn) {
        case 'mute': {
            const m = this.hud!.toggleMute();
            this.audio?.setMuted(m);
            if (this.save) { this.save.data.settings.muted = m; this.persist(); }
            break;
        }
        case 'start':
        case 'restart':
            this.startMode('endless');
            break;
        case 'startJourney':
            this.startMode('journey');
            break;
        case 'pause':
            core.pause();
            break;
        case 'resume':
            core.resume();
            break;
        case 'revive':
            this.requestAd('revive');
            break;
        case 'doubleCoins':
            this.requestAd('doubleCoins');
            break;
        case 'cycleSkin':
            if (core.state === 'title') this.cycleSkin();
            break;
        }
    }
}
