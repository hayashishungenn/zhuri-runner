/**
 * Hud2D —— 双渲染器共用的 2D UI 层：HUD、标题/死亡面板、广告模拟浮层、弹字、红闪/暗角/慢动作黑边。
 * 视觉与 P0 原型一致（移植）。按钮布局由本类唯一持有，命中测试也在此。
 */
import { Node, Graphics, Label, UITransform, UIOpacity, Color, Layers } from 'cc';
import { GameConfig, formatUi } from '../config/GameConfigSchema';
import { GameCore } from '../core/GameCore';
import { AdService } from '../platform/AdService';
import { DESIGN_W, DESIGN_H, LX, LY } from './layout';

export type HudButton = 'start' | 'revive' | 'restart' | 'mute';

/** P0 面板色板（美术常量，非玩法参数） */
const C_MAIN = () => new Color(255, 207, 125, 255);
const C_WHITE = () => new Color(255, 255, 255, 255);
const C_HINT = () => new Color(255, 233, 201, 255);
const C_NOTE = () => new Color(154, 140, 114, 255);
const C_SUB = () => new Color(216, 203, 174, 255);
const C_PANEL_TXT = () => new Color(240, 220, 178, 255);
const C_PANEL_FRAG = () => new Color(184, 166, 132, 255);
const C_BTN2 = () => new Color(232, 220, 194, 255);

/** P0 按钮命中区（逻辑坐标 450x800，y 向下） */
const HIT = {
    mute: { x0: 408, x1: 446, y0: 20, y1: 62 },
    start: { x0: 80, x1: 370, y0: 440, y1: 482 },
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
        if (core.state === 'title' && inRect(HIT.start)) return 'start';
        if (core.state === 'dead') {
            if (core.reviveUsable() && inRect(HIT.revive)) return 'revive';
            if (inRect(HIT.restart)) return 'restart';
        }
        return null;
    }

    toggleMute(): boolean { this.muted = !this.muted; return this.muted; }
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
        const adShow = ad.active;
        if (showTitle || showDead || adShow) {
            ui.fillColor = new Color(10, 8, 6, 180);
            ui.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); ui.fill();
        }
        this.titleOp.opacity = showTitle ? 255 : 0;
        if (showTitle) {
            ui.fillColor = new Color(255, 207, 125, 60);
            ui.roundRect(LX(90), LY(445), 270 * 1.6, 50 * 1.6, 14 * 1.6); ui.fill();
            ui.lineWidth = 2; ui.strokeColor = new Color(240, 190, 110, 100);
            ui.roundRect(LX(90), LY(445), 270 * 1.6, 50 * 1.6, 14 * 1.6); ui.stroke();
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
