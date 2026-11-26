/**
 * Hud2D —— 双渲染器共用的 2D UI 层：HUD、标题/死亡面板、广告模拟浮层、弹字、红闪/暗角/慢动作黑边。
 * 视觉与 P0 原型一致（移植）。按钮布局由本类唯一持有，命中测试也在此。
 */
import { Node, Graphics, Label, UITransform, UIOpacity, Color, Layers } from 'cc';
import { GameConfig, formatUi } from '../config/GameConfigSchema';
import { GameCore } from '../core/GameCore';
import { AdService } from '../platform/AdService';
import { DESIGN_W, DESIGN_H, LX, LY } from './layout';

export type HudButton = 'start' | 'startJourney' | 'revive' | 'restart' | 'mute' | 'pause' | 'resume';

/** P0 面板色板（美术常量，非玩法参数） */
const C_MAIN = () => new Color(255, 207, 125, 255);
const C_WHITE = () => new Color(255, 255, 255, 255);
const C_HINT = () => new Color(255, 233, 201, 255);
const C_NOTE = () => new Color(154, 140, 114, 255);
const C_SUB = () => new Color(216, 203, 174, 255);
const C_PANEL_TXT = () => new Color(240, 220, 178, 255);
const C_PANEL_FRAG = () => new Color(184, 166, 132, 255);
const C_BTN2 = () => new Color(232, 220, 194, 255);

/** 按钮命中区（逻辑坐标 450x800，y 向下） */
const HIT = {
    mute: { x0: 408, x1: 446, y0: 20, y1: 62 },
    pause: { x0: 356, x1: 394, y0: 20, y1: 62 },
    start: { x0: 80, x1: 370, y0: 440, y1: 482 },
    startJourney: { x0: 80, x1: 370, y0: 488, y1: 532 },
    revive: { x0: 60, x1: 390, y0: 465, y1: 500 },
    restart: { x0: 60, x1: 390, y0: 525, y1: 560 },
};

interface PopSlot { lbl: Label; op: UIOpacity; t: number; }

export class Hud2D {
    private uiG: Graphics = null!;
    private lblDist!: Label;
    private lblFrag!: Label;
    private lblHint!: UIOpacity;
    private lblTitle!: Label;
    private lblSub!: Label;
    private lblNote!: Label;
    private lblBtnStart!: Label;
    private lblPTitle!: Label;
    private lblPDist!: Label;
    private lblPFrag!: Label;
    private lblPBtn1!: Label;
    private lblPBtn2!: Label;
    private lblPNote!: Label;
    private lblAdT!: Label;
    private lblAdC!: Label;
    private lblAdN!: Label;
    private lblSpeed!: Label;
    private lblItems!: Label;
    private lblHeat!: Label;
    private lblJourney!: Label;
    private lblBest!: Label;
    private lblBtnJourney!: Label;
    private lblEndedT!: Label;
    private lblEndedS!: Label;
    private lblSkin!: Label;
    private lblPaused!: Label;
    private lblResume!: Label;
    private lblRestart2!: Label;
    private titleOp!: UIOpacity;
    private panelOp!: UIOpacity;
    private adOp!: UIOpacity;
    private pops: [PopSlot, PopSlot];
    private cfg: GameConfig;
    private muted = false;
    private firstInput = false;

    constructor(parent: Node, cfg: GameConfig) {
        this.cfg = cfg;
        this.uiG = this.makeNode(parent, 'hud-ui').addComponent(Graphics);
        const lc = C_MAIN();

        const hd = this.makeLabel(parent, 'hDist', 34, lc); this.lblDist = hd.lbl;
        const hf = this.makeLabel(parent, 'hFrag', 26, C_WHITE()); this.lblFrag = hf.lbl;
        const hint = this.makeLabel(parent, 'hHint', 20, C_HINT()); this.lblHint = hint.op;
        hint.lbl.string = cfg.ui.hintSwipe;
        hint.node.setPosition(0, LY(560), 0);

        const pa = this.makeLabel(parent, 'popA', 22, lc); const popA: PopSlot = { lbl: pa.lbl, op: pa.op, t: 0 };
        const pb = this.makeLabel(parent, 'popB', 22, lc); const popB: PopSlot = { lbl: pb.lbl, op: pb.op, t: 0 };
        pa.op.opacity = 0; pb.op.opacity = 0;
        this.pops = [popA, popB];

        const tt = this.makeLabel(parent, 'tTitle', 110, C_MAIN());
        tt.lbl.string = cfg.ui.title; this.lblTitle = tt.lbl; this.titleOp = tt.op;
        tt.node.setPosition(0, LY(300), 0);
        const ts = this.makeLabel(parent, 'tSub', 24, C_SUB());
        ts.lbl.string = cfg.ui.subtitle; this.lblSub = ts.lbl;
        ts.node.setPosition(0, LY(360), 0);
        const tn = this.makeLabel(parent, 'tNote', 18, C_NOTE());
        tn.lbl.string = cfg.ui.hintSwipe; this.lblNote = tn.lbl;
        tn.node.setPosition(0, LY(470), 0);
        const tb = this.makeLabel(parent, 'tBtn', 34, C_HINT());
        tb.lbl.string = cfg.ui.startBtn; this.lblBtnStart = tb.lbl;
        tb.node.setPosition(0, LY(460), 0);

        const pt1 = this.makeLabel(parent, 'pTitle', 44, lc);
        pt1.lbl.string = cfg.ui.deadTitle; this.lblPTitle = pt1.lbl; this.panelOp = pt1.op;
        pt1.node.setPosition(0, LY(300), 0);
        const pd = this.makeLabel(parent, 'pDist', 26, C_PANEL_TXT());
        this.lblPDist = pd.lbl; pd.node.setPosition(0, LY(356), 0);
        const pf = this.makeLabel(parent, 'pFrag', 20, C_PANEL_FRAG());
        this.lblPFrag = pf.lbl; pf.node.setPosition(0, LY(392), 0);
        const pb1 = this.makeLabel(parent, 'pBtn1', 26, C_HINT());
        pb1.lbl.string = cfg.ui.reviveBtn; this.lblPBtn1 = pb1.lbl;
        pb1.node.setPosition(0, LY(490), 0);
        const pb2 = this.makeLabel(parent, 'pBtn2', 24, C_BTN2());
        pb2.lbl.string = cfg.ui.restartBtn; this.lblPBtn2 = pb2.lbl;
        pb2.node.setPosition(0, LY(540), 0);
        const pn = this.makeLabel(parent, 'pNote', 14, C_NOTE());
        pn.lbl.string = cfg.ui.reviveNote; this.lblPNote = pn.lbl;
        pn.node.setPosition(0, LY(600), 0);
        this.panelOp.opacity = 0;

        const at = this.makeLabel(parent, 'aT', 30, lc);
        at.lbl.string = cfg.ui.adTitle; this.lblAdT = at.lbl; this.adOp = at.op;
        at.node.setPosition(0, LY(330), 0);
        const ac = this.makeLabel(parent, 'aC', 70, new Color(255, 232, 194, 255));
        this.lblAdC = ac.lbl; ac.node.setPosition(0, LY(400), 0);
        const an = this.makeLabel(parent, 'aN', 16, C_NOTE());
        an.lbl.string = cfg.ui.adNote; this.lblAdN = an.lbl;
        an.node.setPosition(0, LY(470), 0);
        this.adOp.opacity = 0;

        // 速度显示（Phase 1）
        const sp = this.makeLabel(parent, 'hSpeed', 22, C_WHITE());
        this.lblSpeed = sp.lbl;
        sp.node.setPosition(LX(160), LY(95), 0);
        // 道具状态（Phase 3）：活跃道具 + 剩余秒
        const it = this.makeLabel(parent, 'hItems', 18, new Color(120, 200, 255, 255));
        this.lblItems = it.lbl;
        it.node.setPosition(LX(110), LY(60), 0);
        // 热量（Phase 4）
        const ht = this.makeLabel(parent, 'hHeat', 18, new Color(255, 150, 80, 255));
        this.lblHeat = ht.lbl;
        ht.node.setPosition(LX(160), LY(60), 0);
        // 征途进度（Phase 4）
        const jn = this.makeLabel(parent, 'hJourney', 16, new Color(255, 224, 160, 255));
        this.lblJourney = jn.lbl;
        jn.node.setPosition(0, LY(8), 0);
        // 标题：最佳纪录
        const bs = this.makeLabel(parent, 'tBest', 18, C_NOTE());
        this.lblBest = bs.lbl;
        bs.node.setPosition(0, LY(395), 0);
        // 标题：征途模式按钮
        const pj = this.makeLabel(parent, 'tBtnJ', 26, C_HINT());
        pj.lbl.string = cfg.ui.modeJourney; this.lblBtnJourney = pj.lbl;
        pj.node.setPosition(0, LY(510), 0);
        // 胜利面板
        const et = this.makeLabel(parent, 'eTitle', 48, lc);
        et.lbl.string = cfg.ui.endedTitle; this.lblEndedT = et.lbl;
        et.node.setPosition(0, LY(280), 0);
        const es = this.makeLabel(parent, 'eSub', 20, C_PANEL_TXT());
        es.lbl.string = cfg.ui.endedSub; this.lblEndedS = es.lbl;
        es.node.setPosition(0, LY(345), 0);
        this.lblEndedT.node.active = false;
        this.lblEndedS.node.active = false;
        // 标题：皮肤循环按钮 + 当前皮肤名
        const sk = this.makeLabel(parent, 'tSkinBtn', 20, C_NOTE());
        sk.lbl.string = '换肤 ›';
        sk.node.setPosition(LX(392), LY(430), 0);
        const skn = this.makeLabel(parent, 'tSkinName', 20, C_PANEL_TXT());
        this.lblSkin = skn.lbl;
        skn.node.setPosition(LX(280), LY(430), 0);
        this.lblSkin.node.active = false;

        // 暂停面板
        const pt = this.makeLabel(parent, 'zTitle', 44, lc);
        pt.lbl.string = cfg.ui.pausedTitle; this.lblPaused = pt.lbl;
        pt.node.setPosition(0, LY(300), 0);
        const pr = this.makeLabel(parent, 'zResume', 26, C_HINT());
        pr.lbl.string = cfg.ui.resumeBtn; this.lblResume = pr.lbl;
        pr.node.setPosition(0, LY(490), 0);
        const pz = this.makeLabel(parent, 'zRestart', 24, C_BTN2());
        pz.lbl.string = cfg.ui.restartBtn; this.lblRestart2 = pz.lbl;
        pz.node.setPosition(0, LY(540), 0);
        this.lblPaused.node.active = false;
        this.lblResume.node.active = false;
        this.lblRestart2.node.active = false;
    }

    private makeNode(parent: Node, name: string): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        n.setParent(parent);
        const ut = n.addComponent(UITransform);
        ut.setContentSize(DESIGN_W, DESIGN_H);
        return n;
    }

    private makeLabel(parent: Node, name: string, size: number, color: Color): { node: Node; lbl: Label; op: UIOpacity } {
        const n = this.makeNode(parent, name);
        const lbl = n.addComponent(Label);
        lbl.fontSize = size;
        lbl.lineHeight = Math.round(size * 1.25);
        lbl.color = color;
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.string = '';
        const op = n.addComponent(UIOpacity);
        n.setPosition(0, 0, 0);
        return { node: n, lbl, op };
    }

    // ---------- 输入 ----------
    hitTestButtons(gx: number, gy: number, core: GameCore): HudButton | null {
        const inRect = (r: typeof HIT.mute) => gx > r.x0 && gx < r.x1 && gy > r.y0 && gy < r.y1;
        if (inRect(HIT.mute)) return 'mute';
        if (core.state === 'run') {
            if (core.paused) {
                if (inRect(HIT.revive)) return 'resume';       // 与死亡面板同行的复用布局
                if (inRect(HIT.restart)) return 'restart';
            } else if (inRect(HIT.pause)) return 'pause';
        }
        if (core.state === 'title') {
            if (inRect(HIT.start)) return 'start';
            if (inRect(HIT.startJourney)) return 'startJourney';
        }
        if (core.state === 'dead') {
            if (core.reviveUsable() && inRect(HIT.revive)) return 'revive';
            if (inRect(HIT.restart)) return 'restart';
        }
        return null;
    }

    toggleMute(): boolean { this.muted = !this.muted; return this.muted; }

    private bestLi = 0;
    private skinIdx = 0;
    private skinLabels: string[] = [];
    /** 标题显示无尽最佳纪录（Game 装配时注入；起跑刷新） */
    setBestLi(v: number) { this.bestLi = Math.floor(v); }
    /** 皮肤循环状态（标题按钮显示当前皮肤名） */
    setSkinIdx(idx: number, labels: string[]) {
        this.skinIdx = idx % Math.max(labels.length, 1);
        this.skinLabels = labels;
        this.lblSkin.string = labels[this.skinIdx] ?? '';
    }
    /** 标题换肤按钮命中（逻辑坐标） */
    hitSkinButton(gx: number, gy: number): boolean {
        return gx > 360 && gx < 424 && gy > 420 && gy < 442;
    }
    markFirstInput() { this.firstInput = true; }

    // ---------- 弹字 ----------
    showPop(x: number, y: number, txt: string, big: boolean, c: Color) {
        const slot = this.pops[0].op.opacity <= 0 ? this.pops[0] : (this.pops[1].op.opacity <= 0 ? this.pops[1] : this.pops[Math.random() < 0.5 ? 0 : 1]);
        slot.lbl.string = txt;
        slot.lbl.fontSize = big ? 30 : 20;
        slot.lbl.color = c;
        slot.lbl.node.setPosition(LX(x), LY(y), 0);
        slot.op.opacity = 255;
        slot.t = 0;
    }

    /** 每帧驱动：弹字浮起淡出 + 首次操作提示闪烁 */
    update(dt: number, core: GameCore) {
        for (const slot of this.pops) {
            if (slot.op.opacity > 0) {
                slot.t += dt;
                const t = slot.t / 0.9;
                if (t >= 1) { slot.op.opacity = 0; continue; }
                slot.op.opacity = Math.max(0, 255 * (1 - t * t));
                slot.lbl.node.setPosition(slot.lbl.node.position.x, slot.lbl.node.position.y + dt * 46, 0);
            }
        }
        if (!this.firstInput && core.state === 'run') this.lblHint.opacity = Math.floor(150 + 105 * Math.sin(core.gTime * 4));
        else this.lblHint.opacity = 0;
    }

    /**
     * 每帧绘制 UI 层（HUD/面板/浮层/红闪/暗角/慢动作边）。
     * @param slowAmt 慢动作强度 [0,1]（渲染器根据 timeScale 计算）
     * @param redFlash 红闪强度 [0,1]（渲染器维护）
     */
    render(core: GameCore, ad: AdService, slowAmt: number, redFlash: number) {
        const ui = this.uiG;
        ui.clear();

        // 红闪
        if (redFlash > 0) {
            ui.fillColor = new Color(200, 40, 20, Math.floor(Math.max(0, redFlash) * 128));
            ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); ui.fill();
        }
        // 暗角
        ui.fillColor = new Color(12, 4, 2, 60);
        ui.rect(-DESIGN_W / 2, DESIGN_H / 2 - 40, DESIGN_W, 40); ui.fill();
        ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, 40); ui.fill();

        // ---------- HUD ----------
        ui.fillColor = new Color(12, 10, 8, 140);
        ui.roundRect(-350, 530, 700, 94, 24); ui.fill();
        this.lblDist.string = formatUi(this.cfg.ui.distLabel, Math.floor(core.li));
        this.lblDist.node.setPosition(0, LY(45), 0);
        this.lblFrag.string = formatUi(this.cfg.ui.fragLabel, core.frags);
        this.lblFrag.node.setPosition(LX(70), LY(95), 0);
        this.lblSpeed.string = formatUi(this.cfg.ui.speedLabel, Math.round(core.effectiveSpeed));
        // 道具状态文本（优先级：冲刺 > 护盾 > 磁吸 > 倍率）
        const parts: string[] = [];
        if (core.dashT > 0) parts.push(`御风 ${core.dashT.toFixed(0)}`);
        if (core.leapT > 0) parts.push(`巨跃 ${core.leapT.toFixed(0)}`);
        if (core.staffCharges > 0) parts.push(`神杖 ×${core.staffCharges}`);
        if (core.shieldCharges > 0) parts.push('护盾 ●');
        if (core.magnetT > 0) parts.push(`磁吸 ${core.magnetT.toFixed(0)}`);
        if (core.doubleT > 0) parts.push(`×2 ${core.doubleT.toFixed(0)}`);
        this.lblItems.string = parts.join(' · ');
        // 热量条（Phase 4）：HUD 面板内横条 + 数值，≥warnAt 红色闪烁
        const heatN = Math.round(core.heat);
        const warn = core.heat >= this.cfg.heat.warnAt;
        this.lblHeat.string = formatUi(this.cfg.ui.heatLabel, heatN);
        const warnPulse = warn ? Math.floor(120 + Math.abs(Math.sin(core.gTime * 6)) * 135) : 255;
        this.lblHeat.node.getComponent(UIOpacity)!.opacity = warnPulse;
        {
            const bx = LX(198), by = LY(60), bw = 150, bh = 12;
            ui.fillColor = new Color(40, 24, 16, 200);
            ui.rect(bx, by, bw, bh); ui.fill();
            const frac = core.heat / 100;
            const hc = warn ? new Color(255, 60, 30, 255) : new Color(255, 150 + frac * 60, 60, 255);
            ui.fillColor = hc;
            ui.rect(bx, by, bw * frac, bh); ui.fill();
            if (warn) {
                ui.fillColor = new Color(255, 60, 30, Math.floor(Math.abs(Math.sin(core.gTime * 6)) * 70));
                ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); ui.fill();
            }
        }
        // 征途进度条（仅征途模式）
        if (core.mode === 'journey') {
            const stages = this.cfg.journey.stages;
            const final = stages[stages.length - 1].goalLi;
            const frac = Math.min(core.li / final, 1);
            const bx = LX(90), by = LY(14), bw = 540, bh = 8;
            ui.fillColor = new Color(40, 24, 16, 190);
            ui.rect(bx, by, bw, bh); ui.fill();
            ui.fillColor = new Color(255, 207, 125, 230);
            ui.rect(bx, by, bw * frac, bh); ui.fill();
            this.lblJourney.node.setPosition(0, LY(32), 0);
            const stageLabel = core.journeyStage < stages.length
                ? formatUi(this.cfg.ui.stageLabel, 0).replace('{label}', stages[core.journeyStage].label).replace('{n}', String(stages[core.journeyStage].goalLi))
                : this.cfg.ui.endedTitle;
            this.lblJourney.string = stageLabel;
            this.lblJourney.node.active = true;
        } else {
            this.lblJourney.node.active = false;
        }

        // 路口转向提示（窗口开启时显示方向箭头）
        if (core.state === 'run' && core.turnWindow) {
            const dir = core.turnWindow.dir;
            const cx = LX(225), cy = LY(230);
            const a = 46 * 1.6, b = 26 * 1.6;
            ui.fillColor = new Color(255, 209, 102, 210 + Math.floor(Math.sin(core.gTime * 9) * 40));
            if (dir === 1) {          // 左转箭头 ◀
                ui.moveTo(cx - a, cy); ui.lineTo(cx + b * 0.4, cy + b); ui.lineTo(cx + b * 0.4, cy - b);
                ui.close(); ui.fill();
                ui.rect(cx + b * 0.4, cy - 7, 30 * 1.6, 14); ui.fill();
            } else {                  // 右转箭头 ▶
                ui.moveTo(cx + a, cy); ui.lineTo(cx - b * 0.4, cy + b); ui.lineTo(cx - b * 0.4, cy - b);
                ui.close(); ui.fill();
                ui.rect(cx - b * 0.4 - 30 * 1.6, cy - 7, 30 * 1.6, 14); ui.fill();
            }
        }

        // 暂停按钮（奔跑中且未暂停时显示 ❚❚）
        if (core.state === 'run' && !core.paused) {
            ui.fillColor = new Color(255, 255, 255, 32);
            ui.circle(LX(375), LY(42), 30); ui.fill();
            ui.fillColor = new Color(232, 220, 194, 255);
            ui.rect(LX(366), LY(54), 6 * 1.6, 15 * 1.6); ui.fill();
            ui.rect(LX(380), LY(54), 6 * 1.6, 15 * 1.6); ui.fill();
        }

        // 静音按钮
        ui.fillColor = new Color(255, 255, 255, 32);
        ui.circle(LX(425), LY(42), 30); ui.fill();
        if (!this.muted) {
            ui.lineWidth = 3; ui.strokeColor = new Color(232, 220, 194, 255);
            ui.moveTo(LX(418), LY(48)); ui.lineTo(LX(418), LY(36));
            ui.lineTo(LX(424), LY(36)); ui.lineTo(LX(429), LY(31));
            ui.lineTo(LX(429), LY(53)); ui.lineTo(LX(424), LY(48));
            ui.lineTo(LX(418), LY(48)); ui.stroke();
            ui.arc(LX(430), LY(42), 10, -0.9, 0.9, false); ui.stroke();
        } else {
            ui.lineWidth = 4; ui.strokeColor = new Color(255, 122, 106, 255);
            ui.moveTo(LX(432), LY(34)); ui.lineTo(LX(440), LY(50));
            ui.moveTo(LX(440), LY(34)); ui.lineTo(LX(432), LY(50));
            ui.stroke();
        }

        // 慢动作黑边
        if (slowAmt > 0.02) {
            ui.fillColor = new Color(0, 0, 0, Math.floor(slowAmt * 190));
            ui.rect(-DESIGN_W / 2, DESIGN_H / 2 - 42 * slowAmt * 1.6, DESIGN_W, 42 * slowAmt * 1.6); ui.fill();
            ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, 42 * slowAmt * 1.6); ui.fill();
        }

        // ---------- 面板 ----------
        const showTitle = core.state === 'title';
        const showDead = core.state === 'dead';
        const showPaused = core.state === 'run' && core.paused;
        const adShow = ad.active;
        if (showTitle || showDead || adShow || showPaused) {
            ui.fillColor = new Color(10, 8, 6, 180);
            ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); ui.fill();
        }
        // 暂停面板
        this.lblPaused.node.active = showPaused;
        this.lblResume.node.active = showPaused;
        this.lblRestart2.node.active = showPaused;
        if (showPaused) {
            ui.fillColor = new Color(60, 46, 30, 200);
            ui.roundRect(LX(60), LY(465), 330 * 1.6, 50 * 1.6, 12 * 1.6); ui.fill();
            ui.fillColor = new Color(158, 43, 30, 220);
            ui.roundRect(LX(60), LY(525), 330 * 1.6, 50 * 1.6, 12 * 1.6); ui.fill();
        }
        this.titleOp.opacity = showTitle ? 255 : 0;
        this.lblBest.node.active = showTitle;
        if (showTitle) this.lblBest.string = formatUi(this.cfg.ui.bestLabel, this.bestLi);
        this.lblBtnJourney.node.active = showTitle;
        if (showTitle) {
            ui.fillColor = new Color(255, 207, 125, 60);
            ui.roundRect(LX(90), LY(445), 270 * 1.6, 50 * 1.6, 14 * 1.6); ui.fill();
            ui.lineWidth = 2; ui.strokeColor = new Color(240, 190, 110, 100);
            ui.roundRect(LX(90), LY(445), 270 * 1.6, 50 * 1.6, 14 * 1.6); ui.stroke();
            ui.fillColor = new Color(255, 207, 125, 60);
            ui.roundRect(LX(90), LY(488), 270 * 1.6, 44 * 1.6, 14 * 1.6); ui.fill();
        }
        // 胜利面板（征途通关）
        const showEnded = core.state === 'ended';
        this.lblEndedT.node.active = showEnded;
        this.lblEndedS.node.active = showEnded;
        if (showEnded) {
            ui.fillColor = new Color(255, 190, 90, 70);
            ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); ui.fill();
        }
        this.panelOp.opacity = showDead ? 255 : 0;
        if (showDead) {
            this.lblPDist.string = formatUi(this.cfg.ui.deadDistLabel, Math.floor(core.li));
            this.lblPFrag.string = formatUi(this.cfg.ui.deadFragLabel, core.frags);
            if (core.reviveUsable()) {
                ui.fillColor = new Color(158, 43, 30, 255);
                ui.roundRect(LX(60), LY(465), 330 * 1.6, 50 * 1.6, 12 * 1.6); ui.fill();
            }
            ui.fillColor = new Color(60, 46, 30, 200);
            ui.roundRect(LX(60), LY(525), 330 * 1.6, 50 * 1.6, 12 * 1.6); ui.fill();
        }
        this.adOp.opacity = adShow ? 255 : 0;
        if (adShow) {
            this.lblAdC.string = ad.done ? '✓' : String(ad.stepsLeft);
        }
    }
}
