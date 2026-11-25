/**
 * 逐日 · 夸父逐日神话跑酷 —— 引导层。
 * 职责仅装配：加载配置 → 构建 核心/输入/渲染/广告 → 每帧驱动与事件路由。
 * 玩法规则全部在 core/GameCore；画面在 render/*；平台在 platform/*。
 */
import { _decorator, Component, Color, error, game, Game as CCGame } from 'cc';
import { loadGameConfig } from './config/GameConfig';
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

    async start() {
        installGlobalErrorHooks();
        let cfg: GameConfig;
        try {
            cfg = await loadGameConfig();     // 非法配置在此抛错（不静默回退）
        } catch (e) {
            error('[Game] 配置加载失败，游戏无法启动: ' + String(e));
            log.error('配置加载失败，游戏无法启动', String(e));
            throw e;
        }
        log.info('配置加载成功 renderMode=' + cfg.renderMode);
        this.cfg = cfg;
        // 90° 转弯仅在 3D 渲染模式启用（2D 回退保持直线跑道，转弯窗口不出现）
        this.core = new GameCore(cfg, undefined, { turnsEnabled: cfg.renderMode === '3d' });
        this.ad = newAdService(cfg);
        // 2D 渲染器需先于 Hud2D 创建节点，保证 UI 绘制在世界之上
        if (cfg.renderMode === '2d') this.renderer = new Renderer2D(this.node, cfg);
        this.hud = new Hud2D(this.node, cfg);
        if (cfg.renderMode === '3d') this.renderer = new Renderer3D(cfg);
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
        this.routeEvents(events);
        this.hud.update(dtRaw, this.core);
        this.renderer.onCoreEvents(events);
        this.renderer.render(this.core, this.ad, dtRaw, this.hud);
    }

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
            }
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
            },
            onActionStart: () => {
                if (this.core && this.core.state === 'title') this.core.startRun();
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
