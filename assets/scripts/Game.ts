/**
 * 逐日 · 夸父逐日神话跑酷 —— 引导层（Phase 8.2 瘦身版）。
 * 职责仅装配与表现路由：加载配置 → 构建 GameCore / GameSession / 输入 / 渲染 / 广告 / 音频 → 每帧驱动与事件路由。
 * 玩法规则在 core/GameCore；单局生命周期与成长经济事务在 core/GameSession；画面在 render/*；平台在 platform/*。
 */
import { _decorator, Component, Color, error, game, Game as CCGame } from 'cc';
import { loadGameConfig, loadObstacleCatalog, loadSkins, loadTileTemplates } from './config/GameConfig';
import { SkinCatalog } from './config/SkinCatalog';
import { formatUi, GameConfig } from './config/GameConfigSchema';
import { GameCore } from './core/GameCore';
import { GameSession } from './core/GameSession';
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
import { Save } from './platform/Save';
import { AudioMgr, SfxName } from './audio/AudioMgr';
import { LOGICAL_W, PLAYER_Y } from './render/layout';
import { ACHIEVEMENTS } from './core/Achievements';
import { UpgradeKind, UPGRADE_DEFS, totalLevels } from './core/Upgrades';
import { deepFreeze, validateAllConfigs } from './config/ConfigRegistry';

const { ccclass } = _decorator;
const log = new Logger('Game');

@ccclass('Game')
export class Game extends Component {
    private cfg: GameConfig | null = null;
    private core: GameCore | null = null;
    private session: GameSession | null = null;
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
    private lastStep = -1;
    page: string | null = null;
    private lifecycleDispose: (() => void) | null = null;

    async start() {
        installGlobalErrorHooks();
        let cfg: GameConfig;
        let catalog;
        let skins;
        let tiles;
        try {
            [cfg, catalog, skins, tiles] = await Promise.all([
                loadGameConfig(), loadObstacleCatalog(), loadSkins(), loadTileTemplates(),
            ]);
            const crossErrs = validateAllConfigs({ game: cfg, obstacles: catalog, skins, tiles });
            if (crossErrs.length) throw new Error('跨配置校验失败：\n  - ' + crossErrs.join('\n  - '));
            // 冻结基础配置，禁止运行期意外改写共享配置
            deepFreeze(cfg);
            deepFreeze(catalog);
            deepFreeze(skins);
            deepFreeze(tiles);
        } catch (e) {
            error('[Game] 配置加载失败，游戏无法启动: ' + String(e));
            log.error('配置加载失败，游戏无法启动', String(e));
            throw e;
        }
        this.catalog = catalog;
        this.skins = skins;
        this.cfg = cfg;
        this.core = this.core ?? new GameCore(cfg, undefined, { turnsEnabled: cfg.renderMode === '3d', catalog });
        this.core.mapGen.tileIds = tiles.templates.map((t) => ({ id: t.id, kind: t.kind, theme: t.theme }));

        this.platform = createPlatform();
        const lc = this.platform.lifecycle({ onHide: () => this.onGameHide(), onShow: () => this.onGameShow() });
        if (!lc.supported) log.warn('平台生命周期不支持: ' + (lc.reason ?? '未知'));
        this.lifecycleDispose = lc.dispose ?? null;

        this.save = new Save(this.platform.storage);
        this.session = new GameSession({
            core: this.core,
            save: this.save,
            skinIds: skins.skins.map((s) => s.id),
            today: () => this.today(),
        });
        this.skinIdx = this.resolveCatalogSkinIdx(this.session.currentSkinId);

        this.audio = new AudioMgr(this.node);
        this.audio.setMuted(this.save.data.settings.muted);
        void this.audio.load();
        log.info('配置加载成功 renderMode=' + cfg.renderMode + ' 障碍种类=' + catalog.obstacles.length);

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

        if (cfg.renderMode === '2d') this.renderer = new Renderer2D(this.node, cfg, catalog);
        this.hud = new Hud2D(this.node, cfg);
        this.hud.setBestLi(this.save.data.bestLi);
        this.hud.syncMuted(this.save.data.settings.muted);
        if (cfg.renderMode === '3d') {
            const r3d = new Renderer3D(cfg, catalog);
            r3d.setTileTemplates(tiles.templates);
            this.renderer = r3d;
        }
        this.applySkin();

        this.inputCtl = new InputController(this.makeDelegate(), cfg.input);
        this.inputCtl.attach();
        this.hud.setHandlers({
            onPageAction: (action: string) => this.onPageAction(action),
            onTutorialSkip: () => this.session?.tutorial.skip(),
            onNavPage: (page: string) => {
                if (this.core?.state !== 'title') return;
                if (page === 'tutorial') { this.startTutorial(); return; }
                this.page = page;
                this.refreshPage();
            },
        });
        game.on(CCGame.EVENT_HIDE, this.onGameHide, this);
        game.on(CCGame.EVENT_SHOW, this.onGameShow, this);
        log.info('装配完成');
    }

    onDestroy() {
        this.inputCtl?.detach();
        this.renderer?.destroy();
        this.audio?.destroy();
        this.ad?.dispose();
        this.lifecycleDispose?.();
        game.off(CCGame.EVENT_HIDE, this.onGameHide, this);
        game.off(CCGame.EVENT_SHOW, this.onGameShow, this);
    }

    private onGameHide() {
        this.ad?.onHide();
        if (this.session && this.session.state === 'running') {
            this.session.onBackgroundHide();
            log.info('切后台自动暂停');
        }
    }

    private onGameShow() {
        this.session?.onBackgroundResume();
        this.ad?.onShow();
        const res = this.platform.resumeAudio();
        if (!res.supported) log.warn('音频恢复不可用: ' + (res.reason ?? ''));
    }

    update(dtRaw: number) {
        if (!this.core || !this.session || !this.renderer || !this.hud || !this.ad) return;
        const tick = this.session.tick(dtRaw);
        if (tick.bestLiUpdated && this.save) {
            this.hud.setBestLi(this.save.data.bestLi);
        }
        if (tick.settled && tick.isFirstSettle) {
            this.ad.stats.record('run_end', this.core.mode);
            this.ad.noteRunEnd();
            this.ad.maybeShowInterstitial();
            this.persistAds();
        }
        if (tick.revertedSkinId) {
            this.syncVisualSkin(tick.revertedSkinId);
        }
        // 教程步骤在 Session 内推进，HUD 文案必须每帧同步，否则玩家永远只看到第一步
        const tut = this.session.tutorial;
        if (this.session.isTutorialRun && !tut.done && tut.step) {
            this.hud.showTutorialHint(tut.step.text, !this.save?.data.tutorial.done);
        } else {
            this.hud.hideTutorialHint();
        }
        this.routeEvents(tick.events);
        this.hud.update(dtRaw, this.core);
        this.renderer.onCoreEvents(tick.events);
        this.renderer.render(this.core, this.ad, dtRaw, this.hud);
        this.playRunSfx(tick.events);
    }

    private playRunSfx(events: ReturnType<GameCore['drainEvents']>) {
        const core = this.core!;
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

    private routeEvents(events: ReturnType<GameCore['drainEvents']>) {
        const hud = this.hud!;
        const amber = new Color(255, 209, 102, 255);
        const main = new Color(255, 207, 125, 255);
        for (const e of events) {
            if (e.type === 'fragment') {
                const lane = e.lane ?? 0;
                hud.showPop(LOGICAL_W / 2 + lane * 60, PLAYER_Y - 130, `+${e.amount ?? 1}`, false, amber);
            } else if (e.type === 'milestone') {
                hud.showPop(LOGICAL_W / 2, 250, formatUi(this.cfg!.ui.milestoneText, e.n ?? 0), true, main);
            } else if (e.type === 'stumble') {
                hud.showPop(LOGICAL_W / 2, 320, this.cfg!.ui.stumbleText, true, new Color(255, 122, 82, 255));
            } else if (e.type === 'item') {
                const def = this.catalog?.items.find((x) => x.id === e.kind);
                hud.showPop(LOGICAL_W / 2 + (e.lane ?? 0) * 60, PLAYER_Y - 170, def?.label ?? String(e.kind), true, new Color(120, 200, 255, 255));
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
            }
        }
    }

    private resolveCatalogSkinIdx(skinId: string): number {
        if (!this.skins) return 0;
        const idx = this.skins.skins.findIndex((x) => x.id === skinId);
        return idx >= 0 ? idx : 0;
    }

    private applySkin() {
        if (!this.skins || !this.renderer?.applySkin) return;
        const skin = this.skins.skins[this.skinIdx % this.skins.skins.length];
        this.renderer.applySkin(skin);
    }

    private syncVisualSkin(skinId: string) {
        if (!this.skins) return;
        this.skinIdx = this.resolveCatalogSkinIdx(skinId);
        this.applySkin();
        this.hud?.setSkinIdx(this.skinIdx, this.skins.skins.map((x) => x.label));
    }

    private persistAds(): void {
        if (!this.save || !this.session) return;
        if (this.ad) this.save.data.ads = this.ad.stats.data;
        if (!this.session.persist()) {
            log.warn('存档写入失败（游戏继续运行）', this.save.lastError ?? 'writeLocked');
        }
    }

    private requestAd(scene: AdScene): void {
        if (!this.ad || !this.session) return;
        const ticket = this.session.prepareAdTicket(scene);
        if (!ticket) {
            this.hud?.showPop(LOGICAL_W / 2, 300, '当前无可领取奖励', false, new Color(255, 170, 90, 255));
            return;
        }
        const check = this.ad.canUse(scene);
        if (!check.ok) {
            this.hud?.showPop(LOGICAL_W / 2, 300, '广告暂不可用', false, new Color(255, 122, 106, 255));
            return;
        }
        void this.ad.requestReward(scene, () => {
            const outcome = this.session!.applyAdReward(ticket);
            if (!outcome.applied) return;
            switch (scene) {
            case 'revive':
                this.ad!.stats.record('revive', scene);
                this.audio?.playSfx('revive');
                break;
            case 'doubleCoins':
                this.hud?.showPop(LOGICAL_W / 2, 300, `金币 ×2 +${outcome.bonus ?? 0}`, true, new Color(255, 209, 102, 255));
                break;
            case 'dailyDouble':
                this.refreshPage();
                break;
            case 'timedPower':
                this.hud?.showPop(LOGICAL_W / 2, 300, '下局限时神通 · 已就绪！', true, new Color(120, 200, 255, 255));
                break;
            case 'skinTrial':
                if (outcome.trialSkinId) this.syncVisualSkin(outcome.trialSkinId);
                this.hud?.showPop(LOGICAL_W / 2, 300, '皮肤试用 · 本局生效', true, new Color(255, 207, 125, 255));
                break;
            }
            this.persistAds();
        });
    }

    private startTutorial() {
        if (!this.session || !this.save) return;
        this.startMode('endless', true);
        this.hud?.showTutorialHint(this.session.tutorial.step?.text ?? '', !this.save.data.tutorial.done);
    }

    private today(): string {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    private startMode(mode: 'endless' | 'journey', tutorial = false) {
        if (!this.session) return;
        this.closePage();
        const { activeSkinId } = this.session.startRun(mode, { tutorial });
        this.syncVisualSkin(activeSkinId);
        this.lastStep = -1;
        this.ad?.stats.record('run_start', mode);
        this.persistAds();
    }

    private makeDelegate(): InputDelegate {
        return {
            onGesture: (intent: Intent) => {
                if (!this.session || this.ad?.state === 'showing') return;
                this.hud?.markFirstInput();
                switch (intent) {
                case Intent.LaneLeft: this.session.submitCommand({ type: 'lane', dir: -1 }); break;
                case Intent.LaneRight: this.session.submitCommand({ type: 'lane', dir: 1 }); break;
                case Intent.Jump: this.session.submitCommand({ type: 'jump' }); break;
                case Intent.Slide: this.session.submitCommand({ type: 'slide' }); break;
                }
            },
            onTap: (gx: number, gy: number) => {
                if (!this.core || !this.session || !this.hud || this.ad?.state === 'showing') return;
                const btn = this.hud.hitTestButtons(gx, gy, this.core);
                if (btn) this.onButton(btn);
                else if (this.core.state === 'run') this.session.submitCommand({ type: 'jump' });
            },
            onTapStart: (gx: number, gy: number) => {
                if (!this.core || !this.session || !this.hud || this.ad?.state === 'showing') return;
                if (gx > 408 && gx < 446 && gy > 20 && gy < 62) { const m = this.hud.toggleMute(); this.audio?.setMuted(m); return; }
                if (this.hud.hitTutorialSkip(gx, gy)) { this.session.tutorial.skip(); this.hud.hideTutorialHint(); return; }
                if (this.core.state === 'title' && this.hud.hitSkinButton(gx, gy)) {
                    const nextId = this.session.cycleOwnedSkin();
                    if (nextId) { this.syncVisualSkin(nextId); this.audio?.playSfx('ui'); }
                }
                if (this.page) {
                    const action = this.hud.pageTap(gx, gy);
                    if (action === '__back__') this.closePage();
                    else if (action) this.onPageAction(action);
                    return;
                }
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
                if (!this.session) return;
                if (this.session.state === 'running') this.session.pause();
                else if (this.session.state === 'paused') this.session.resume();
            },
        };
    }

    private onPageAction(action: string): void {
        if (!this.session || !this.save) return;
        if (action === '__back__') { this.closePage(); return; }
        if (action.startsWith('ad:')) { this.requestAd(action.slice(3) as AdScene); return; }
        if (action.startsWith('claimq:')) {
            if (this.session.claimQuest(action.slice(7)) > 0) {
                this.refreshPage();
                this.audio?.playSfx('coin');
            }
            return;
        }
        if (action.startsWith('claima:')) {
            if (this.session.claimAchievement(action.slice(7)) > 0) {
                this.refreshPage();
                this.audio?.playSfx('coin');
            }
            return;
        }
        if (action.startsWith('buy:') || action.startsWith('use:')) {
            const id = action.slice(4);
            const ok = action.startsWith('buy:') ? this.session.buySkin(id) : this.session.equipSkin(id);
            if (ok) {
                this.syncVisualSkin(id);
                this.refreshPage();
                this.audio?.playSfx('ui');
            }
            return;
        }
        if (action.startsWith('up:')) {
            if (this.session.buyUpgrade(action.slice(3) as UpgradeKind)) {
                this.refreshPage();
                this.audio?.playSfx('ui');
            }
            return;
        }
        if (action === 'restore') {
            if (this.session.restoreBackup()) {
                this.ad?.loadStats(this.save.data.ads);
                this.syncVisualSkin(this.session.currentSkinId);
                this.refreshPage();
                this.audio?.playSfx('ui');
            }
            return;
        }
        if (action === 'retutorial') {
            this.save.data.tutorial.done = false;
            this.session.persist();
            this.closePage();
            this.audio?.playSfx('ui');
        }
    }

    private closePage(): void {
        this.page = null;
        this.hud?.closePage();
    }

    private refreshPage(): void {
        if (!this.page || !this.save || !this.skins || !this.session) return;
        const d = this.save.data;
        const goldLbl = `灵光金币 ${this.session.economy.gold}`;
        if (this.page === 'quests') {
            const rows: { label: string; action?: string }[] = [{ label: goldLbl }];
            for (const t of this.session.quests.todays()) {
                const prog = this.session.quests.progressOf(t);
                const done = this.session.quests.isComplete(t);
                const claimed = d.quests.claimed.includes(t.id);
                rows.push({
                    label: `${t.label}  ${prog}/${t.goal}  ${claimed ? '已领' : done ? `【领取 ${t.reward}】` : ''}`,
                    action: done && !claimed ? `claimq:${t.id}` : undefined,
                });
            }
            this.hud?.openPage('quests', '每日任务', rows);
        } else if (this.page === 'achievements') {
            const extra = { skins: d.skinsOwned.length, upgradeLevels: totalLevels(this.session.upgrades.levels) };
            const rows: { label: string; action?: string }[] = [{ label: goldLbl }];
            const unlocked = this.session.ach.unlockedList(d.stats, extra).filter((a) => !this.session!.ach.isClaimed(a, d.achClaimed));
            rows.push({ label: `已解锁 ${this.session.ach.unlockedList(d.stats, extra).length}/${ACHIEVEMENTS.length}` });
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
                const lv = this.session.upgrades.level(def.kind);
                const cost = this.session.upgrades.cost(def.kind);
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
        if (!this.session || !this.core) return;
        switch (btn) {
        case 'mute': {
            const m = this.hud!.toggleMute();
            this.audio?.setMuted(m);
            if (this.save) { this.save.data.settings.muted = m; this.session.persist(); }
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
            this.session.pause();
            break;
        case 'resume':
            this.session.resume();
            break;
        case 'revive':
            this.requestAd('revive');
            break;
        case 'doubleCoins':
            this.requestAd('doubleCoins');
            break;
        case 'cycleSkin':
            if (this.core.state === 'title') {
                const nextId = this.session.cycleOwnedSkin();
                if (nextId) { this.syncVisualSkin(nextId); this.audio?.playSfx('ui'); }
            }
            break;
        }
    }
}
