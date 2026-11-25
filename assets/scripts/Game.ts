import { _decorator, Component, Node, Graphics, Label, UITransform, UIOpacity, Color, input, Input, EventTouch, KeyCode, Layers } from 'cc';
const { ccclass } = _decorator;

/**
 * 逐日 · 夸父逐日神话跑酷
 * 全代码驱动：本组件负责建 UI、跑逻辑、每帧重绘。
 * 坐标约定：内部沿用 450x800 逻辑坐标（原点左上），绘制时 *1.6 映射到 720x1280。
 */

const S = 1.6;           // 逻辑坐标 -> 设计分辨率 缩放
const GW = 450, GH = 800;
const HORIZON = 330, PY = 762;
const MILE_POP = 1000;

@ccclass('Game')
export class Game extends Component {
    // 节点/组件
    private worldG: Graphics = null!;
    private uiG: Graphics = null!;
    private lblDist: Label = null!;
    private lblFrag: Label = null!;
    private lblHint: UIOpacity = null!;
    private lblPopA: Label = null!;   // 弹字池
    private lblPopB: Label = null!;
    private popOpA: UIOpacity = null!;
    private popOpB: UIOpacity = null!;
    private lblTitle: Label = null!;
    private lblSub: Label = null!;
    private lblNote: Label = null!;
    private lblBtnStart: Label = null!;
    private lblPTitle: Label = null!;
    private lblPDist: Label = null!;
    private lblPFrag: Label = null!;
    private lblPBtn1: Label = null!;
    private lblPBtn2: Label = null!;
    private lblPNote: Label = null!;
    private lblAdT: Label = null!;
    private lblAdC: Label = null!;
    private lblAdN: Label = null!;
    private titleOp: UIOpacity = null!;
    private panelOp: UIOpacity = null!;
    private adOp: UIOpacity = null!;

    // 游戏状态
    private state: string = 'title';
    private paused = false;
    private playerLaneF = 0;
    private targetLane = 0;
    private jumpT = -1;
    private slideT = -1;
    private runPhase = 0;
    private dist = 0;
    private frags = 0;
    private speed = 13;
    private obstacles: any[] = [];
    private pickables: any[] = [];
    private props: any[] = [];
    private puffs: any[] = [];
    private pops: any[] = [];
    private spawnAcc = 4;
    private propAcc = 0;
    private shake = 0;
    private redFlash = 0;
    private dieTimer = -1;
    private reviveUsed = false;
    private invincible = 0;
    private milestone = MILE_POP;
    private gTime = 0;
    private timeScale = 1;
    private firstShot = false;
    private muted = false;
    private coinIdx = 0;
    // 广告模拟
    private adShow = false;
    private adCount = 3;
    private adTimer = 0;
    private adDone = false;
    // 触摸
    private swipe: any = null;

    // ---------- 工具 ----------
    private LX(gx: number) { return gx * S - 360; }
    private LY(gy: number) { return 640 - gy * S; }
    private proj(z: number) { return 1.1 / (1.1 + Math.max(z, 0)); }
    private sx(laneF: number, s: number) { return this.LX(225 + laneF * 110 * s); }
    private sy(z: number) { return this.LY(330 + (PY - 330) * this.proj(z)); }
    private col(r: number, g: number, b: number, a: number) { return new Color(r, g, b, a); }
    private grad(c1: number[], c2: number[], t: number): number[] {
        return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
    }

    private makeNode(parent: Node, name: string): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.UI_2D;
        n.setParent(parent);
        const ut = n.addComponent(UITransform);
        ut.setContentSize(720, 1280);
        return n;
    }
    private makeLabel(parent: Node, name: string, size: number, color: Color): { node: Node, lbl: Label, op: UIOpacity } {
        const n = this.makeNode(parent, name);
        const lbl = n.addComponent(Label);
        lbl.fontSize = size;
        lbl.lineHeight = Math.round(size * 1.25);
        lbl.color = color;
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.string = '';
        const op = n.addComponent(UIOpacity);
        n.setPosition(0, 0, 0);
        return { node: n, lbl: lbl, op: op };
    }
    private place(lblSet: any, gx: number, gy: number) {
        lblSet.node.setPosition(this.LX(gx), this.LY(gy), 0);
    }

    // ---------- 生命周期 ----------
    onLoad() {
        const world = this.makeNode(this.node, 'world');
        this.worldG = world.addComponent(Graphics);
        const ui = this.makeNode(this.node, 'ui');
        this.uiG = ui.addComponent(Graphics);
        const lc = this.col(255, 207, 125, 255);

        const hd = this.makeLabel(this.node, 'hDist', 34, lc); this.lblDist = hd.lbl;
        const hf = this.makeLabel(this.node, 'hFrag', 26, this.col(255, 255, 255, 255)); this.lblFrag = hf.lbl;
        const hint = this.makeLabel(this.node, 'hHint', 20, this.col(255, 233, 201, 255)); this.lblHint = hint.op;
        hint.lbl.string = '左右滑动变道 · 上滑跳跃 · 下滑俯冲';
        hint.node.setPosition(0, this.LY(560), 0);

        const pa = this.makeLabel(this.node, 'popA', 22, lc); this.lblPopA = pa.lbl; this.popOpA = pa.op;
        const pb = this.makeLabel(this.node, 'popB', 22, lc); this.lblPopB = pb.lbl; this.popOpB = pb.op;
        pa.op.opacity = 0; pb.op.opacity = 0;

        const tt = this.makeLabel(this.node, 'tTitle', 110, this.col(255, 207, 125, 255));
        tt.lbl.string = '逐 日'; this.lblTitle = tt.lbl; this.titleOp = tt.op;
        tt.node.setPosition(0, this.LY(300), 0);
        const ts = this.makeLabel(this.node, 'tSub', 24, this.col(216, 203, 174, 255));
        ts.lbl.string = '夸父逐日 · 神话跑酷'; this.lblSub = ts.lbl;
        ts.node.setPosition(0, this.LY(360), 0);
        const tn = this.makeLabel(this.node, 'tNote', 18, this.col(154, 140, 114, 255));
        tn.lbl.string = '左右滑动变道 · 上滑跳跃 · 下滑俯冲'; this.lblNote = tn.lbl;
        tn.node.setPosition(0, this.LY(470), 0);
        const tb = this.makeLabel(this.node, 'tBtn', 34, this.col(255, 233, 201, 255));
        tb.lbl.string = '【 起 跑 】'; this.lblBtnStart = tb.lbl;
        tb.node.setPosition(0, this.LY(460), 0);

        const pt1 = this.makeLabel(this.node, 'pTitle', 44, lc);
        pt1.lbl.string = '力 竭'; this.lblPTitle = pt1.lbl; this.panelOp = pt1.op;
        pt1.node.setPosition(0, this.LY(300), 0);
        const pd = this.makeLabel(this.node, 'pDist', 26, this.col(240, 220, 178, 255));
        this.lblPDist = pd.lbl; pd.node.setPosition(0, this.LY(356), 0);
        const pf = this.makeLabel(this.node, 'pFrag', 20, this.col(184, 166, 132, 255));
        this.lblPFrag = pf.lbl; pf.node.setPosition(0, this.LY(392), 0);
        const pb1 = this.makeLabel(this.node, 'pBtn1', 26, this.col(255, 233, 201, 255));
        pb1.lbl.string = '▶ 观看广告 · 原地复活'; this.lblPBtn1 = pb1.lbl;
        pb1.node.setPosition(0, this.LY(490), 0);
        const pb2 = this.makeLabel(this.node, 'pBtn2', 24, this.col(232, 220, 194, 255));
        pb2.lbl.string = '重新起跑'; this.lblPBtn2 = pb2.lbl;
        pb2.node.setPosition(0, this.LY(540), 0);
        const pn = this.makeLabel(this.node, 'pNote', 14, this.col(154, 140, 114, 255));
        pn.lbl.string = '复活每轮一次 · 真机接入 wx.createRewardedVideoAd'; this.lblPNote = pn.lbl;
        pn.node.setPosition(0, this.LY(600), 0);
        this.panelOp.opacity = 0;

        const at = this.makeLabel(this.node, 'aT', 30, lc);
        at.lbl.string = '广告演示'; this.lblAdT = at.lbl; this.adOp = at.op;
        at.node.setPosition(0, this.LY(330), 0);
        const ac = this.makeLabel(this.node, 'aC', 70, this.col(255, 232, 194, 255));
        this.lblAdC = ac.lbl; ac.node.setPosition(0, this.LY(400), 0);
        const an = this.makeLabel(this.node, 'aN', 16, this.col(154, 140, 114, 255));
        an.lbl.string = '真实场景为 15-30 秒激励视频 · 看完才发奖'; this.lblAdN = an.lbl;
        an.node.setPosition(0, this.LY(470), 0);
        this.adOp.opacity = 0;

        // 输入
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    private onTouchStart(e: EventTouch) {
        const u = e.getUILocation();
        const gx = u.x / S, gy = (1280 - u.y) / S;
        // 静音按钮
        if (gx > 408 && gx < 446 && gy > 20 && gy < 62) { this.muted = !this.muted; return; }
        this.swipe = { x: gx, y: gy };
    }
    private onTouchEnd(e: EventTouch) {
        if (!this.swipe) return;
        const u = e.getUILocation();
        const gx = u.x / S, gy = (1280 - u.y) / S;
        const dx = gx - this.swipe.x, dy = gy - this.swipe.y;
        if (this.adShow) { this.swipe = null; return; }
        if (this.state === 'title') {
            if (gx > 80 && gx < 370 && gy > 440 && gy < 482) this.startRun();
            this.swipe = null; return;
        }
        if (this.state === 'dead') {
            if (this.reviveUsable() && gx > 60 && gx < 390 && gy > 465 && gy < 500) { this.tapRevive(); }
            else if (gx > 60 && gx < 390 && gy > 525 && gy < 560) this.startRun();
            this.swipe = null; return;
        }
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 18) this.doLane(dx > 0 ? 1 : -1);
        else if (dy < -18) this.doJump();
        else if (dy > 18) this.doSlide();
        else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && this.state === 'run') this.doJump();
        this.swipe = null;
    }
    private onKey(e: any) {
        if (e.keyCode === KeyCode.ARROW_LEFT || e.keyCode === KeyCode.KEY_A) this.doLane(-1);
        else if (e.keyCode === KeyCode.ARROW_RIGHT || e.keyCode === KeyCode.KEY_D) this.doLane(1);
        else if (e.keyCode === KeyCode.ARROW_UP || e.keyCode === KeyCode.KEY_W || e.keyCode === KeyCode.SPACE) this.doJump();
        else if (e.keyCode === KeyCode.ARROW_DOWN || e.keyCode === KeyCode.KEY_S) this.doSlide();
        else if (e.keyCode === KeyCode.ENTER && this.state === 'title') this.startRun();
    }
    private reviveUsable() { return !this.reviveUsed; }

    private startRun() {
        this.reset();
        this.state = 'run';
    }
    private reset() {
        this.playerLaneF = 0; this.targetLane = 0;
        this.jumpT = -1; this.slideT = -1; this.runPhase = 0;
        this.dist = 0; this.frags = 0; this.speed = 13;
        this.obstacles = []; this.pickables = []; this.props = []; this.puffs = []; this.pops = [];
        this.spawnAcc = 4; this.propAcc = 0;
        this.shake = 0; this.redFlash = 0; this.dieTimer = -1;
        this.reviveUsed = false; this.invincible = 0;
        this.milestone = MILE_POP; this.timeScale = 1; this.paused = false;
    }
    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    }
    private doLane(dir: number) {
        if (this.state !== 'run') return;
        this.targetLane = Math.max(-1, Math.min(1, this.targetLane + dir));
    }
    private doJump() {
        if (this.state !== 'run') return;
        if (this.jumpT < 0) { this.jumpT = 0; this.dust(); }
    }
    private doSlide() {
        if (this.state !== 'run') return;
        if (this.jumpT >= 0) this.jumpT = 0.42;
        this.slideT = 0.55; this.dust();
    }
    private dust() {
        for (let i = 0; i < 7; i++) {
            this.puffs.push({ x: 225 + (Math.random() - 0.5) * 46, y: PY - 4, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, life: 0, max: 0.5 + Math.random() * 0.3, r: 3 + Math.random() * 5 });
        }
    }
    private tapRevive() {
        // 真机：const ad = wx.createRewardedVideoAd({adUnitId:'xxx'}); ad.onClose(res=>res.isEnded&&this.doRevive()); ad.show();
        this.adShow = true; this.adCount = 3; this.adTimer = 0.85; this.adDone = false;
        this.adOp.opacity = 255;
        this.panelOp.opacity = 0;
    }
    private doRevive() {
        this.reviveUsed = true;
        this.obstacles = this.obstacles.filter((o: any) => o.z > 14);
        this.invincible = 2.2; this.state = 'run'; this.timeScale = 1;
    }

    // 三个弹字槽位复用
    private popShow(x: number, y: number, txt: string, big: boolean, c: Color) {
        const slot = this.popOpA.opacity <= 0 ? 'A' : (this.popOpB.opacity <= 0 ? 'B' : (Math.random() < 0.5 ? 'A' : 'B'));
        const lbl = slot === 'A' ? this.lblPopA : this.lblPopB;
        const op = slot === 'A' ? this.popOpA : this.popOpB;
        lbl.string = txt;
        lbl.fontSize = big ? 30 : 20;
        lbl.color = c;
        lbl.node.setPosition(this.LX(x), this.LY(y), 0);
        op.opacity = 255;
        (lbl as any)._popT = 0;
        (lbl as any)._popOp = op;
    }
    private updatePops(dt: number) {
        for (const l of [this.lblPopA, this.lblPopB]) {
            const any = l as any;
            if (any._popOp && any._popOp.opacity > 0) {
                any._popT += dt;
                const t = any._popT / 0.9;
                if (t >= 1) { any._popOp.opacity = 0; continue; }
                any._popOp.opacity = Math.max(0, 255 * (1 - t * t));
                any.node.setPosition(any.node.position.x, any.node.position.y + dt * 46, 0);
            }
        }
    }

    update(dtRaw: number) {
        const dt = Math.min(dtRaw, 0.033);
        this.gTime += dt;
        if (this.adShow) {
            this.adTimer -= dtRaw;
            if (this.adTimer <= 0) {
                if (this.adDone) { this.adShow = false; this.adOp.opacity = 0; this.doRevive(); }
                else { this.adCount--; this.adTimer = 0.85; if (this.adCount <= 0) { this.adCount = 0; this.adDone = true; } }
            }
        }
        if (this.state === 'run' && !this.paused) this.updateRun(dt * this.timeScale);
        else if (this.state === 'dying') this.updateDying(dt * this.timeScale);
        else this.ambientOnly(dt);
        this.updatePops(dt);
        // 提示闪烁
        if (!this.firstShot && this.state === 'run') this.lblHint.opacity = Math.floor(150 + 105 * Math.sin(this.gTime * 4));
        else this.lblHint.opacity = 0;
        this.draw();
    }

    private updateRun(dt: number) {
        this.speed = 13 + Math.min(this.dist * 0.045, 16);
        this.dist += this.speed * dt;
        if (this.dist * 3 >= this.milestone) {
            this.popShow(225, 250, '日影渐近 · ' + this.milestone + ' 里', true, new Color(255, 207, 125, 255));
            this.milestone += MILE_POP;
        }
        if (this.invincible > 0) this.invincible -= dt;
        this.playerLaneF += (this.targetLane - this.playerLaneF) * Math.min(1, dt * 11);
        if (this.jumpT >= 0) { this.jumpT += dt / 0.62; if (this.jumpT >= 1) { this.jumpT = -1; this.dust(); } }
        if (this.slideT >= 0) { this.slideT -= dt; if (this.slideT < 0) this.slideT = -1; }
        this.runPhase += dt * (6 + this.speed * 0.35);
        // 生成
        this.spawnAcc += this.speed * dt;
        if (this.spawnAcc > 8) { this.spawnAcc = 0; this.spawnRow(); }
        this.propAcc += this.speed * dt;
        if (this.propAcc > 2.4) { this.propAcc = 0; this.spawnProp(); }
        // 障碍
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            o.z -= this.speed * dt;
            if (o.z < -2) { this.obstacles.splice(i, 1); continue; }
            if (!o.passed && o.z < 0.55) {
                o.passed = true;
                const myLane = Math.round(this.playerLaneF);
                const jumping = this.jumpT >= 0 && this.jumpT > 0.12 && this.jumpT < 0.88;
                const sliding = this.slideT >= 0;
                let safe = false;
                if (o.lane !== myLane) safe = true;
                else if (o.type === 'rock') safe = jumping;
                else if (o.type === 'log') safe = sliding;
                if (!safe && this.invincible <= 0) { this.crash(); return; }
                if (!safe && this.invincible > 0) { o.z = -3; this.shake = Math.max(this.shake, 6); }
                else if (safe && o.lane === myLane) this.shake = Math.max(this.shake, 2.5);
            }
        }
        // 阳炎
        for (let i = this.pickables.length - 1; i >= 0; i--) {
            const f = this.pickables[i];
            f.z -= this.speed * dt;
            if (f.z < -2) { this.pickables.splice(i, 1); continue; }
            if (!f.got && f.z < 0.9 && f.z > -0.5 && Math.round(this.playerLaneF) === f.lane) {
                f.got = true; this.frags++;
                this.popShow(225 + f.lane * 60, PY - 130, '+1', false, new Color(255, 209, 102, 255));
            }
        }
        for (let i = this.props.length - 1; i >= 0; i--) { this.props[i].z -= this.speed * dt; if (this.props[i].z < -2) this.props.splice(i, 1); }
        this.ambientOnly(dt);
    }

    private updateDying(dt: number) {
        this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 1.4 / Math.max(this.timeScale, 0.2));
        this.shake *= Math.pow(0.05, dt);
        if (this.redFlash > 0) this.redFlash -= dt * 0.8;
        this.dieTimer -= dt * 2.8;
        this.ambientOnly(dt);
        if (this.dieTimer <= 0) {
            this.state = 'dead';
            this.lblPDist.string = '已逐日 ' + Math.floor(this.dist * 3) + ' 里';
            this.lblPFrag.string = '拾得阳炎 × ' + this.frags;
            this.panelOp.opacity = 255;
        }
    }

    private crash() {
        this.state = 'dying'; this.dieTimer = 0.95;
        this.shake = 16; this.redFlash = 0.5;
        this.timeScale = 0.25;
        for (let i = 0; i < 16; i++) {
            this.puffs.push({ x: 225 + (Math.random() - 0.5) * 60, y: PY - 30 - Math.random() * 40, vx: (Math.random() - 0.5) * 160, vy: -40 - Math.random() * 90, life: 0, max: 0.7, r: 4 + Math.random() * 7 });
        }
    }

    private spawnRow() {
        const lanesFree = [-1, 0, 1];
        const n = Math.random() < 0.45 ? 1 : 2;
        const used: number[] = [];
        const types = ['rock', 'log', 'wall'];
        for (let i = 0; i < n; i++) {
            const pick = lanesFree.splice(Math.floor(Math.random() * lanesFree.length), 1)[0];
            const t = types[Math.floor(Math.random() * types.length)];
            this.obstacles.push({ lane: pick, type: t, z: 46, passed: false });
            used.push(pick);
        }
        if (Math.random() < 0.6) {
            const fl = [-1, 0, 1].filter((l) => used.indexOf(l) < 0);
            const lane = fl[Math.floor(Math.random() * fl.length)];
            for (let k = 0; k < 5; k++) this.pickables.push({ lane: lane, z: 47.6 + k * 1.5, got: false });
        }
    }
    private spawnProp() {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.props.push({ x: side * (1.55 + Math.random() * 0.9), z: 46, kind: Math.random() < 0.7 ? 'tree' : 'rock', s: 0.8 + Math.random() * 0.7, sway: Math.random() * 6.28 });
    }

    private ambientOnly(dt: number) {
        for (let i = this.puffs.length - 1; i >= 0; i--) {
            const q = this.puffs[i];
            q.life += dt;
            if (q.life > q.max) { this.puffs.splice(i, 1); continue; }
            q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 140 * dt;
        }
        for (let i = this.pops.length - 1; i >= 0; i--) { this.pops[i].t += dt; if (this.pops[i].t > 0.9) this.pops.splice(i, 1); }
        if (this.redFlash > 0 && this.state !== 'dying') this.redFlash -= dt * 0.8;
        if (this.state !== 'dying') { this.shake *= Math.pow(0.02, dt); this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 3); }
    }

    // ================= 绘制 =================
    private draw() {
        const g = this.worldG;
        g.clear();
        const ui = this.uiG;
        ui.clear();
        const p = Math.min(this.dist * 3 / 30000, 1);
        const slowAmt = Math.max(0, Math.min(1, (1 - this.timeScale) / 0.7));
        // 抖动：整体节点微移
        if (this.shake > 0.3) this.node.setPosition((Math.random() - 0.5) * this.shake * S, (Math.random() - 0.5) * this.shake * S, 0);
        else this.node.setPosition(0, 0, 0);

        // 天空（分段渐变）
        const bands = 12;
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            let c: number[];
            if (t < 0.45) c = this.grad([25, 18, 51], this.grad([90, 32, 40], [70, 40, 80], p), t / 0.45);
            else if (t < 0.8) c = this.grad(this.grad([90, 32, 40], [70, 40, 80], p), this.grad([196, 78, 36], [160, 60, 44], p), (t - 0.45) / 0.35);
            else c = this.grad(this.grad([196, 78, 36], [160, 60, 44], p), this.grad([255, 154, 60], [255, 130, 60], p), (t - 0.8) / 0.2);
            const y0 = this.LY(-20 + (HORIZON + 40) * (i / bands));
            const y1 = this.LY(-20 + (HORIZON + 40) * ((i + 1) / bands));
            g.fillColor = this.col(c[0], c[1], c[2], 255);
            g.rect(-360, y1, 720, y0 - y1 + 1);
            g.fill();
        }
        // 星星
        for (let i = 0; i < 24; i++) {
            const stx = (i * 97 + 31) % 450, sty = 30 + (i * 53 + 17) % 210;
            g.fillColor = this.col(255, 255, 255, Math.floor((0.18 + 0.2 * Math.sin(this.gTime * (1 + i % 3) + i)) * 255));
            g.circle(this.LX(stx), this.LY(sty), 1.6);
            g.fill();
        }
        // 太阳
        const sunR = 52 + p * 46 + Math.sin(this.gTime * 1.2) * 2;
        const sunX = this.LX(225), sunY = this.LY(HORIZON - 26);
        for (let i = 3; i >= 1; i--) {
            g.fillColor = this.col(255, 120, 40, 26 * (4 - i));
            g.circle(sunX, sunY, sunR * (0.9 + i * 0.55));
            g.fill();
        }
        g.fillColor = this.col(255, 217, 138, 255);
        g.circle(sunX, sunY, sunR); g.fill();
        g.fillColor = this.col(255, 244, 214, 190);
        g.circle(sunX - sunR * 0.2, sunY + sunR * 0.2, sunR * 0.55); g.fill();
        g.fillColor = this.col(255, 190, 100, 76);
        g.rect(-360, this.LY(HORIZON + 3), 720, 5 * S); g.fill();

        // 远山
        this.ridge(g, [[-20, 376], [70, 344], [150, 382], [220, 410], [300, 370], [370, 336], [470, 386]], this.col(60, 22, 20, 230));
        this.ridge(g, [[-20, 398], [90, 370], [190, 404], [290, 420], [400, 392], [470, 406]], this.col(40, 16, 14, 242));

        // 跑道
        const steps = 22;
        const ptsL: number[][] = [], ptsR: number[][] = [];
        for (let k = 0; k <= steps; k++) {
            const zz = 46 * (1 - k / steps);
            const s = this.proj(zz);
            const yy = HORIZON + (PY - HORIZON) * s;
            ptsL.push([this.sxLane(-190 / 110, s), this.LY(yy)]);
            ptsR.push([this.sxLane(190 / 110, s), this.LY(yy)]);
        }
        g.fillColor = this.col(58, 34, 20, 255);
        g.moveTo(ptsL[0][0], ptsL[0][1]);
        for (let k = 0; k < ptsL.length; k++) g.lineTo(ptsL[k][0], ptsL[k][1]);
        for (let k = ptsR.length - 1; k >= 0; k--) g.lineTo(ptsR[k][0], ptsR[k][1]);
        g.close(); g.fill();
        // 车道虚线
        g.lineWidth = 3; g.strokeColor = this.col(255, 210, 140, 72);
        for (let j = -1; j <= 1; j += 2) {
            let started = false;
            for (let k = 0; k <= steps; k++) {
                const zz2 = 46 * (1 - k / steps);
                if (((zz2 * 1.4 + this.gTime * 2) % 2.2) > 1.1) continue;
                const s = this.proj(zz2);
                const yy = HORIZON + (PY - HORIZON) * s;
                const x1 = this.sxLane(j * 0.5, s);
                if (!started) { g.moveTo(x1, this.LY(yy)); started = true; } else g.lineTo(x1, this.LY(yy));
            }
            g.stroke();
        }
        // 路缘
        g.lineWidth = 5; g.strokeColor = this.col(255, 170, 90, 128);
        g.moveTo(ptsL[0][0], ptsL[0][1]);
        for (let k = 0; k < ptsL.length; k++) g.lineTo(ptsL[k][0], ptsL[k][1]);
        g.stroke();
        g.moveTo(ptsR[0][0], ptsR[0][1]);
        for (let k = 0; k < ptsR.length; k++) g.lineTo(ptsR[k][0], ptsR[k][1]);
        g.stroke();

        // 场景物（按深度排序）
        const scene: any[] = [];
        for (const o of this.props) scene.push({ z: o.z, kind: 'prop', o: o });
        for (const o of this.obstacles) scene.push({ z: o.z, kind: 'ob', o: o });
        for (const o of this.pickables) if (!o.got) scene.push({ z: o.z, kind: 'frag', o: o });
        scene.sort((a, b) => b.z - a.z);
        for (const it of scene) {
            const s2 = this.proj(it.z);
            const oy = HORIZON + (PY - HORIZON) * s2;
            if (it.kind === 'prop') {
                const pr = it.o;
                const px = this.sxLane(pr.x, s2);
                const th = 120 * pr.s * s2 * S;
                const swy = Math.sin(this.gTime * 1.6 + pr.sway) * 4 * s2 * S;
                g.fillColor = this.col(29, 14, 8, 255);
                g.rect(px - 10 * s2, this.LY(oy) , 20 * s2, th);
                g.fill();
                g.circle(px + swy, this.LY(oy) + th + 18 * pr.s * s2 * S, 40 * pr.s * s2 * S * 0.6);
                g.fill();
            } else if (it.kind === 'ob') {
                const ob = it.o, ox = this.sxLane(ob.lane, s2), oyLY = this.LY(oy);
                g.fillColor = this.col(0, 0, 0, 76);
                g.ellipse(ox, oyLY, 40 * s2 * S, 10 * s2 * S);
                g.fill();
                if (ob.type === 'rock') {
                    g.fillColor = this.col(58, 36, 20, 255);
                    g.moveTo(ox - 40 * s2 * S, oyLY);
                    g.lineTo(ox - 26 * s2 * S, oyLY + 34 * s2 * S);
                    g.lineTo(ox - 4 * s2 * S, oyLY + 44 * s2 * S);
                    g.lineTo(ox + 24 * s2 * S, oyLY + 30 * s2 * S);
                    g.lineTo(ox + 40 * s2 * S, oyLY);
                    g.close(); g.fill();
                    g.fillColor = this.col(255, 180, 100, 90);
                    g.moveTo(ox - 26 * s2 * S, oyLY + 34 * s2 * S); g.lineTo(ox - 4 * s2 * S, oyLY + 44 * s2 * S); g.lineTo(ox + 2 * s2 * S, oyLY + 20 * s2 * S);
                    g.close(); g.fill();
                } else if (ob.type === 'log') {
                    g.fillColor = this.col(44, 24, 13, 255);
                    g.rect(ox - 44 * s2 * S, oyLY, 8 * s2 * S, 70 * s2 * S); g.fill();
                    g.rect(ox + 36 * s2 * S, oyLY, 8 * s2 * S, 70 * s2 * S); g.fill();
                    g.fillColor = this.col(64, 34, 15, 255);
                    g.rect(ox - 52 * s2 * S, oyLY + 70 * s2 * S, 104 * s2 * S, 16 * s2 * S); g.fill();
                    g.lineWidth = 3; g.strokeColor = this.col(255, 209, 102, 204);
                    g.moveTo(ox - 44 * s2 * S, oyLY + 96 * s2 * S); g.lineTo(ox + 44 * s2 * S, oyLY + 96 * s2 * S); g.stroke();
                } else {
                    g.fillColor = this.col(51, 29, 16, 255);
                    g.moveTo(ox - 52 * s2 * S, oyLY);
                    g.lineTo(ox - 44 * s2 * S, oyLY + 96 * s2 * S);
                    g.lineTo(ox - 10 * s2 * S, oyLY + 118 * s2 * S);
                    g.lineTo(ox + 34 * s2 * S, oyLY + 104 * s2 * S);
                    g.lineTo(ox + 52 * s2 * S, oyLY + 40 * s2 * S);
                    g.lineTo(ox + 50 * s2 * S, oyLY);
                    g.close(); g.fill();
                    g.fillColor = this.col(0, 0, 0, 90);
                    g.rect(ox - 6 * s2 * S, oyLY, 10 * s2 * S, 40 * s2 * S); g.fill();
                }
            } else {
                const fg = it.o;
                const fx = this.sxLane(fg.lane, s2);
                const fy = this.LY(oy - 34 * s2) + Math.sin(this.gTime * 5 + fg.z) * 4 * s2 * S;
                for (let i2 = 2; i2 >= 0; i2--) {
                    g.fillColor = this.col(255, 150, 40, 30 * (3 - i2));
                    g.circle(fx, fy, 16 * s2 * S * (0.5 + i2 * 0.4));
                    g.fill();
                }
                g.fillColor = this.col(255, 209, 102, 255);
                g.moveTo(fx, fy + 7 * s2 * S);
                g.quadraticCurveTo(fx + 6 * s2 * S, fy, fx, fy - 7 * s2 * S);
                g.quadraticCurveTo(fx - 6 * s2 * S, fy, fx, fy + 7 * s2 * S);
                g.fill();
            }
        }
        // 灰尘
        for (const q of this.puffs) {
            g.fillColor = this.col(138, 106, 72, Math.floor(Math.max(0, 1 - q.life / q.max) * 128));
            g.circle(this.LX(q.x), this.LY(q.y), q.r * S);
            g.fill();
        }
        // 夸父
        this.drawKuafu(g);
        // 速度线
        if (this.speed > 19 && this.state === 'run') {
            g.lineWidth = 3; g.strokeColor = this.col(255, 230, 190, 64);
            for (let i = 0; i < 8; i++) {
                const a2 = (i / 8) * 6.283 + this.gTime * 3;
                const r1 = 180 + Math.sin(this.gTime * 6 + i * 2) * 20;
                const cx = this.LX(225), cy = this.LY(400);
                g.moveTo(cx + Math.cos(a2) * r1 * S, cy + Math.sin(a2) * r1 * S);
                g.lineTo(cx + Math.cos(a2) * (r1 + 60) * S, cy + Math.sin(a2) * (r1 + 60) * S);
                g.stroke();
            }
        }
        // 红闪
        if (this.redFlash > 0) {
            ui.fillColor = this.col(200, 40, 20, Math.floor(Math.max(0, this.redFlash) * 128));
            ui.rect(-360, -640, 720, 1280); ui.fill();
        }
        // 暗角
        ui.fillColor = this.col(12, 4, 2, 60);
        ui.rect(-360, -640, 720, 40); ui.fill();
        ui.rect(-360, 600, 720, 40); ui.fill();

        // ---------- HUD ----------
        ui.fillColor = this.col(12, 10, 8, 140);
        ui.roundRect(-350, 530, 700, 94, 24); ui.fill();
        this.lblDist.string = '已逐 ' + Math.floor(this.dist * 3) + ' 里';
        this.lblDist.node.setPosition(0, this.LY(45), 0);
        this.lblFrag.string = '阳炎 × ' + this.frags;
        this.lblFrag.node.setPosition(this.LX(70), this.LY(95), 0);
        // 静音按钮
        ui.fillColor = this.col(255, 255, 255, 32);
        ui.circle(this.LX(425), this.LY(42), 30); ui.fill();
        if (!this.muted) {
            ui.lineWidth = 3; ui.strokeColor = this.col(232, 220, 194, 255);
            ui.moveTo(this.LX(418), this.LY(48)); ui.lineTo(this.LX(418), this.LY(36));
            ui.lineTo(this.LX(424), this.LY(36)); ui.lineTo(this.LX(429), this.LY(31));
            ui.lineTo(this.LX(429), this.LY(53)); ui.lineTo(this.LX(424), this.LY(48));
            ui.lineTo(this.LX(418), this.LY(48)); ui.stroke();
            ui.arc(this.LX(430), this.LY(42), 10, -0.9, 0.9); ui.stroke();
        } else {
            ui.lineWidth = 4; ui.strokeColor = this.col(255, 122, 106, 255);
            ui.moveTo(this.LX(432), this.LY(34)); ui.lineTo(this.LX(440), this.LY(50));
            ui.moveTo(this.LX(440), this.LY(34)); ui.lineTo(this.LX(432), this.LY(50));
            ui.stroke();
        }
        // 慢动作黑边 + 字幕
        if (slowAmt > 0.02) {
            ui.fillColor = this.col(0, 0, 0, Math.floor(slowAmt * 190));
            ui.rect(-360, 640 - 42 * slowAmt * S, 720, 42 * slowAmt * S); ui.fill();
            ui.rect(-360, -640, 720, 42 * slowAmt * S); ui.fill();
        }

        // ---------- 面板 ----------
        const showTitle = this.state === 'title';
        const showDead = this.state === 'dead';
        if (showTitle || showDead || this.adShow) {
            ui.fillColor = this.col(10, 8, 6, 180);
            ui.rect(-360, -640, 720, 1280); ui.fill();
        }
        this.titleOp.opacity = showTitle ? 255 : 0;
        if (showTitle) {
            ui.fillColor = this.col(255, 207, 125, 60);
            ui.roundRect(this.LX(90), this.LY(445), 270 * S, 50 * S, 14 * S); ui.fill();
            ui.lineWidth = 2; ui.strokeColor = this.col(240, 190, 110, 100);
            ui.roundRect(this.LX(90), this.LY(445), 270 * S, 50 * S, 14 * S); ui.stroke();
        }
        this.panelOp.opacity = showDead ? 255 : 0;
        if (showDead) {
            if (this.reviveUsable()) {
                ui.fillColor = this.col(158, 43, 30, 255);
                ui.roundRect(this.LX(60), this.LY(465), 330 * S, 50 * S, 12 * S); ui.fill();
            }
            ui.fillColor = this.col(60, 46, 30, 200);
            ui.roundRect(this.LX(60), this.LY(525), 330 * S, 50 * S, 12 * S); ui.fill();
        }
        this.adOp.opacity = this.adShow ? 255 : 0;
        if (this.adShow) {
            this.lblAdC.string = this.adDone ? '✓' : '' + this.adCount;
        }
    }

    private sxLane(laneF: number, s: number) { return this.LX(225 + laneF * 110 * s); }

    private ridge(g: Graphics, pts: number[][], c: Color) {
        g.fillColor = c;
        g.moveTo(this.LX(-20), this.LY(HORIZON));
        for (const pt of pts) g.lineTo(this.LX(pt[0]), this.LY(pt[1]));
        g.lineTo(this.LX(470), this.LY(HORIZON));
        g.close(); g.fill();
    }

    private drawKuafu(g: Graphics) {
        const px = this.LX(225 + this.playerLaneF * 110);
        const air = this.jumpT >= 0;
        const hop = air ? Math.sin(this.jumpT * Math.PI) * 92 : 0;
        const sliding = this.slideT >= 0;
        const baseY = this.LY(PY - hop);
        // 影子
        g.fillColor = this.col(0, 0, 0, Math.max(30, 76 - hop * 0.6));
        g.ellipse(px, this.LY(PY) + 6, 34 * S - hop * 0.12, 9);
        g.fill();
        const body = this.col(26, 17, 10, this.invincible > 0 && Math.floor(this.gTime * 10) % 2 === 0 ? 90 : 255);
        g.fillColor = body;
        const torsoH = sliding ? 30 : 44;
        const cy = baseY;
        g.lineCap = 'round';
        if (!sliding) {
            g.lineWidth = 12; g.strokeColor = body;
            const ls = air ? 0.5 : Math.sin(this.runPhase);
            const ls2 = air ? -0.4 : Math.sin(this.runPhase + Math.PI);
            g.moveTo(px, cy - 52 * S);
            g.lineTo(px + ls * 13 * S, cy - 26 * S + (air ? -10 * S : 0));
            g.lineTo(px + ls * 20 * S, cy - (air ? 6 * S : 2 * S));
            g.stroke();
            g.moveTo(px, cy - 52 * S);
            g.lineTo(px + ls2 * 13 * S, cy - 26 * S + (air ? -6 * S : 0));
            g.lineTo(px + ls2 * 20 * S, cy - (air ? 0 : 2 * S));
            g.stroke();
        } else {
            g.lineWidth = 12; g.strokeColor = body;
            g.moveTo(px - 10 * S, cy - 14 * S); g.lineTo(px + 20 * S, cy - 8 * S);
            g.stroke();
        }
        g.lineCap = 'butt';
        // 躯干（髋部 cy-52S，向上）
        g.ellipse(px, cy - 52 * S + torsoH * S * 0.35 + (sliding ? 14 * S : 0), 15 * S, torsoH * S * 0.62, sliding ? 1.1 : 0);
        g.fill();
        // 手臂
        if (!sliding) {
            const ay = cy - 52 * S + torsoH * S * 0.6;
            g.lineWidth = 10; g.lineCap = 'round';
            g.moveTo(px, ay);
            g.lineTo(px - Math.sin(this.runPhase) * 14 * S - 6, ay - 20 * S);
            g.stroke();
            g.moveTo(px, ay);
            g.lineTo(px + Math.sin(this.runPhase) * 14 * S + 6, ay - 20 * S);
            g.stroke();
            g.lineCap = 'butt';
        }
        // 头 + 发髻
        const hy = cy - 52 * S + torsoH * S + 10 * S;
        g.circle(px, hy, 14 * S); g.fill();
        g.circle(px, hy + 13 * S, 6.5 * S); g.fill();
        // 桃木杖（肩背，手动旋转坐标）
        const a1 = -0.7 + Math.sin(this.runPhase) * 0.04;
        const cx0 = px, cy0 = hy - 4 * S;
        const dx = Math.cos(a1) * 26 * S, dy = Math.sin(a1) * 26 * S;
        g.lineWidth = 8; g.strokeColor = this.col(74, 44, 24, 255);
        g.moveTo(cx0 - dx, cy0 - dy); g.lineTo(cx0 + dx, cy0 + dy); g.stroke();
        g.lineWidth = 4; g.strokeColor = this.col(122, 74, 36, 255);
        g.circle(cx0 + dx, cy0 + dy, 6 * S); g.stroke();
    }
}
