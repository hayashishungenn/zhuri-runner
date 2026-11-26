/**
 * 逐日 · 夸父逐日神话跑酷 —— 引导层。
 * 职责仅装配：加载配置 → 构建 核心/输入/渲染/广告 → 每帧驱动与事件路由。
 * 玩法规则全部在 core/GameCore；画面在 render/*；平台在 platform/*。
 */
import { _decorator, Component, Color, error, game, Game as CCGame, sys } from 'cc';
import { loadGameConfig, loadObstacleCatalog, loadSkins, loadTileTemplates } from './config/GameConfig';
import { SkinCatalog } from './config/SkinCatalog';
import { TileTemplateCatalog } from './config/TileTemplates';
import { formatUi, GameConfig } from './config/GameConfigSchema';
import { GameCore } from './core/GameCore';
import { Logger } from './core/Logger';
import { Intent } from './core/types';
import { InputController, InputDelegate } from './input/InputController';
import { Hud2D, HudButton } from './render/Hud2D';
import { IRenderer } from './render/IRenderer';
import { Renderer2D } from './render/Renderer2D';
import { Renderer3D } from './render/Renderer3D';
import { AdService, newAdService } from './platform/AdService';
import { installGlobalErrorHooks } from './platform/ErrorHooks';
import { Save } from './platform/Save';
import { AudioMgr, SfxName } from './audio/AudioMgr';
import { LOGICAL_W, PLAYER_Y } from './render/layout';

const { ccclass } = _decorator;
const log = new Logger('Game');

@ccclass('Game')
export class Game extends Component {
    private cfg: GameConfig | null = null;
    private core: GameCore | null = null;
    private hud: Hud2D | null = null;
    private renderer: IRenderer | null = null;
    private inputCtl: InputController | null = null;
    private ad: AdService | null = null;
    private catalog: import('./config/ObstacleCatalog').ObstacleCatalog | null = null;
    private skins: SkinCatalog | null = null;
    private save: Save | null = null;
    private audio: AudioMgr | null = null;
    private skinIdx = 0;

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
        this.save = new Save({
            get: (k: string) => sys.localStorage.getItem(k),
            set: (k: string, v: string) => { sys.localStorage.setItem(k, v); },
        });
        this.skinIdx = Number(sys.localStorage.getItem('zhuri.skin') ?? 0) % (skins.skins.length || 1);
        this.audio = new AudioMgr(this.node);
        void this.audio.load();
        log.info('配置加载成功 renderMode=' + cfg.renderMode + ' 障碍种类=' + catalog.obstacles.length);
        this.cfg = cfg;
        this.ad = newAdService(cfg);
        // 2D 渲染器需先于 Hud2D 创建节点，保证 UI 绘制在世界之上
        if (cfg.renderMode === '2d') this.renderer = new Renderer2D(this.node, cfg, catalog);
        this.hud = new Hud2D(this.node, cfg);
        if (this.save) this.hud.setBestLi(this.save.bestLi());
        if (cfg.renderMode === '3d') this.renderer = new Renderer3D(cfg, catalog);
        this.inputCtl = new InputController(this.makeDelegate(), cfg.input);
        this.inputCtl.attach();
        // 退后台自动暂停（微信 onHide / 浏览器切页），回到前台由玩家手动恢复
        game.on(CCGame.EVENT_HIDE, this.onGameHide, this);
        log.info('装配完成');
    }

    onDestroy() {
        this.inputCtl?.detach();
        this.renderer?.destroy();
        game.off(CCGame.EVENT_HIDE, this.onGameHide, this);
    }

    private onGameHide() {
        if (this.core && this.core.state === 'run' && !this.core.paused) {
            this.core.pause();
            log.info('切后台自动暂停');
        }
    }

    update(dtRaw: number) {
        if (!this.core || !this.renderer || !this.hud || !this.ad) return;
        this.core.update(dtRaw);
        this.ad.update(dtRaw);
        const events = this.core.drainEvents();
        // 结算存档：无尽最佳（死亡/通关瞬间）+ 征途通关标记
        if (this.save) {
            for (const e of events) {
                if (e.type === 'died' && this.core.mode === 'endless') {
                    if (this.save.setBestLi(this.core.li)) this.hud?.setBestLi(this.save.bestLi());
                }
                if (e.type === 'journeyDone') this.save.setJourneyDone();
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
            case 'jump': break;   // 起跳音由手势侧触发（jump 音效在 doJump 事件）
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
        sys.localStorage.setItem('zhuri.skin', String(this.skinIdx));
        this.applySkin();
        this.hud?.setSkinIdx(this.skinIdx, this.skins.skins.map((x) => x.label));
        this.audio?.playSfx('ui');
    }

    /** 按模式启动；记录模式（core.mode 影响征途判定与太阳进度） */
    private startMode(mode: 'endless' | 'journey') {
        const core = this.core!;
        core.mode = mode;
        core.startRun();
        this.saveBest();
    }

    /** 无尽模式：更新最佳纪录（每次起跑/死亡结算时刷新） */
    private saveBest() {
        if (!this.save || !this.core) return;
        if (this.core.mode === 'endless' && this.core.li > 0) {
            this.save.setBestLi(this.core.li);
        }
    }

    private makeDelegate(): InputDelegate {
        return {
            onGesture: (intent: Intent) => {
                if (!this.core || this.ad?.active) return;   // 广告展示期吞掉手势（与 P0 一致）
                this.hud?.markFirstInput();
                switch (intent) {
                case Intent.LaneLeft: this.core.doLane(-1); break;
                case Intent.LaneRight: this.core.doLane(1); break;
                case Intent.Jump: this.core.doJump(); break;
                case Intent.Slide: this.core.doSlide(); break;
                }
            },
            onTap: (gx: number, gy: number) => {
                if (!this.core || !this.hud || this.ad?.active) return;
                const btn = this.hud.hitTestButtons(gx, gy, this.core);
                if (btn) this.onButton(btn);
                else if (this.core.state === 'run') this.core.doJump();
            },
            onTapStart: (gx: number, gy: number) => {
                if (!this.core || !this.hud) return;
                if (gx > 408 && gx < 446 && gy > 20 && gy < 62) this.hud.toggleMute();
                if (this.core.state === 'title' && this.hud.hitSkinButton(gx, gy)) this.cycleSkin();
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

    private onButton(btn: HudButton) {
        const core = this.core!;
        switch (btn) {
        case 'mute':
                this.hud!.toggleMute();
            break;
        case 'start':
        case 'restart':
            core.startRun();
            break;
        case 'revive':
                // 真机由 WxAdService 拉起 wx.createRewardedVideoAd（P4 接真实 adUnitId）
                this.ad!.show(() => core.revive());
            break;
        }
    }

}
