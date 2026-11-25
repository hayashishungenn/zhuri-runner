/**
 * ProceduralKuafu —— 几何体程序化夸父（CharacterAnimator 实现）。
 * 状态机驱动的动作表现（任务书：所有动作必须有实际逻辑，不允许仅播动画）：
 *   idle：轻微呼吸起伏
 *   run：四肢按 runPhase 交替摆动
 *   jump：四肢收拢姿势，随 hop 离地（位置由渲染器应用 lastHop）
 *   slide：下蹲压低 + 前倾
 *   stumble：躯干前倾 + 高频晃动 + 手臂乱摆（受击踉跄）
 *   dead：dying 期间前扑倒地（0.5s 倒地插值），之后保持
 */
import { Node, Layers } from 'cc';
import { CharacterAnimator, AnimInput, CharAnimState } from './CharacterAnimator';

const BODY: [number, number, number] = [26, 17, 10];
const STAFF: [number, number, number] = [74, 44, 24];
const DEG = 57.29578;

export class ProceduralKuafu implements CharacterAnimator {
    private root3d!: Node;
    private shadow3d!: Node;
    private torso!: Node;
    private head!: Node;
    private legL!: Node; private legR!: Node;
    private armL!: Node; private armR!: Node;
    private staff!: Node;

    private state: CharAnimState = 'idle';
    private deadT = 0;          // 倒地插值计时
    private _lastHop = 0;
    private yawDeg = 0;         // 世界航向（转弯后由输入驱动）

    constructor(
        private makeNode: (parent: Node, name: string, kind: 'box' | 'sphere' | 'cyl' | 'cone', rgb: [number, number, number]) => Node,
        parent: Node,
    ) {
        this.root3d = new Node('kuafu');
        this.root3d.layer = Layers.Enum.DEFAULT;
        parent.addChild(this.root3d);
        this.torso = this.makeNode(this.root3d, 'torso', 'cyl', BODY);
        this.torso.setPosition(0, 0.78, 0); this.torso.setScale(0.32, 0.62, 0.24);
        const chest = this.makeNode(this.root3d, 'chest', 'sphere', BODY);
        chest.setPosition(0, 1.12, 0); chest.setScale(0.3, 0.3, 0.22);
        this.head = this.makeNode(this.root3d, 'head', 'sphere', BODY);
        this.head.setPosition(0, 1.36, 0); this.head.setScale(0.38, 0.38, 0.38);
        const bun = this.makeNode(this.root3d, 'bun', 'sphere', BODY);
        bun.setPosition(0, 1.6, -0.06); bun.setScale(0.17, 0.17, 0.17);
        this.legL = this.limb('legL', 0.52, -0.13, 0.52);
        this.legR = this.limb('legR', 0.52, 0.13, 0.52);
        this.armL = this.limb('armL', 1.05, -0.2, 0.42);
        this.armR = this.limb('armR', 1.05, 0.2, 0.42);
        this.staff = this.makeNode(this.root3d, 'staff', 'cyl', STAFF);
        this.staff.setPosition(0, 1.0, -0.26);
        this.staff.setScale(0.07, 0.07, 1.15);
        this.shadow3d = this.makeNode(parent, 'kuafuShadow', 'cyl', [12, 6, 3]);
        this.shadow3d.setPosition(0, 0.02, 0); this.shadow3d.setScale(0.8, 0.02, 0.8);
    }

    get root(): Node { return this.root3d; }
    get shadow(): Node { return this.shadow3d; }
    get lastHop(): number { return this._lastHop; }

    private limb(name: string, pivotY: number, x: number, len: number): Node {
        const pivot = new Node(name);
        pivot.layer = Layers.Enum.DEFAULT;
        pivot.setParent(this.root3d);
        pivot.setPosition(x, pivotY, 0);
        const seg = this.makeNode(pivot, 'seg', 'cyl', BODY);
        seg.setPosition(0, -len / 2, 0);
        seg.setScale(0.16, len, 0.16);
        return pivot;
    }

    update(dt: number, input: AnimInput) {
        // 状态切换：进入 dead 时重置倒地计时
        if (input.state !== this.state) {
            if (input.state === 'dead' && this.state !== 'dead') this.deadT = 0;
            this.state = input.state;
        }
        this._lastHop = input.jumpT >= 0 ? Math.sin(input.jumpT * Math.PI) * 1.42 : 0;
        const root = this.root3d;
        root.setPosition(root.position.x, this._lastHop, 0);
        this.yawDeg = input.yawDeg;

        switch (this.state) {
        case 'idle': this.poseIdle(input); break;
        case 'run': this.poseRun(input); break;
        case 'jump': this.poseJump(input); break;
        case 'slide': this.poseSlide(input); break;
        case 'stumble': this.poseStumble(input); break;
        case 'dead': this.poseDead(dt, input); break;
        }
        // 影子随高度收缩
        const ss = Math.max(0.3, 1 - this._lastHop * 0.5);
        this.shadow3d.setScale(0.8 * ss, 0.02, 0.8 * ss);
    }

    private poseIdle(input: AnimInput) {
        const bob = Math.sin(input.gTime * 2) * 0.02;
        this.root3d.setScale(1, 1, 1);
        this.root3d.setRotationFromEuler(bob * 60, this.yawDeg, 0);
        this.setLimbs(0, 0.1);
        this.staff.setRotationFromEuler(0, 0, 28);
    }

    private poseRun(input: AnimInput) {
        const swing = Math.sin(input.runPhase) * 0.6;
        this.root3d.setScale(1, 1, 1);
        this.root3d.setRotationFromEuler(6, this.yawDeg, 0);           // 轻微前倾
        this.setLimbs(swing, 0);
        this.staff.setRotationFromEuler(0, 0, 28 + Math.sin(input.runPhase) * 3);
    }

    private poseJump(input: AnimInput) {
        // 起跳收腿：进度前半段收拢、后半段准备落地
        const tuck = input.jumpT >= 0 ? Math.sin(Math.min(input.jumpT, 1) * Math.PI) : 0;
        this.root3d.setScale(1, 1, 1);
        this.root3d.setRotationFromEuler(-8 + tuck * 10, this.yawDeg, 0);
        this.legL.setRotationFromEuler((0.9 * tuck + 0.2) * DEG, 0, 0);
        this.legR.setRotationFromEuler((-0.5 * tuck) * DEG, 0, 0);
        this.armL.setRotationFromEuler((-1.4 * tuck - 0.3) * DEG, 0, 0);
        this.armR.setRotationFromEuler((-1.2 * tuck - 0.3) * DEG, 0, 0);
        this.staff.setRotationFromEuler(0, 0, 28);
    }

    private poseSlide(_input: AnimInput) {
        this.root3d.setScale(1, 0.62, 1);
        this.root3d.setRotationFromEuler(-55, this.yawDeg, 0);
        this.setLimbs(0.2, 0.9);                              // 腿前伸、手臂后摆
        this.staff.setRotationFromEuler(0, 0, 10);
    }

    private poseStumble(input: AnimInput) {
        // 踉跄：高频晃动 + 前倾加深 + 手臂乱摆
        const wobble = Math.sin(input.gTime * 18) * 0.12;
        this.root3d.setScale(1, 0.92, 1);
        this.root3d.setRotationFromEuler(16 + wobble * DEG * 0.5, this.yawDeg, wobble * DEG);
        this.setLimbs(Math.sin(input.gTime * 20) * 0.9, -0.8);
        this.staff.setRotationFromEuler(0, 0, 28 + Math.sin(input.gTime * 20) * 8);
    }

    private poseDead(dt: number, _input: AnimInput) {
        // dying 期间 0.5s 前扑倒地，之后保持
        this.deadT = Math.min(this.deadT + dt, 0.5);
        const k = this.deadT / 0.5;
        this.root3d.setScale(1, 1 - 0.25 * k, 1);
        this.root3d.setRotationFromEuler(-70 * k, this.yawDeg, 0);
        this.root3d.setPosition(this.root3d.position.x, this._lastHop * (1 - k), k * 0.5);
        this.setLimbs(-0.6 * (1 - k), 1.2 * k);
        this.staff.setRotationFromEuler(0, 0, 28 + 40 * k);
    }

    private setLimbs(swing: number, armOffset: number) {
        this.legL.setRotationFromEuler(swing * DEG, 0, 0);
        this.legR.setRotationFromEuler(-swing * DEG, 0, 0);
        this.armL.setRotationFromEuler((-swing + armOffset) * DEG, 0, 0);
        this.armR.setRotationFromEuler((swing + armOffset) * DEG, 0, 0);
    }

    /** 无敌闪烁（3D 层无透明材质，以显隐替代） */
    setVisible(v: boolean) {
        this.root3d.active = v;
    }

    destroy() {
        this.root3d.destroy();
        this.shadow3d.destroy();
    }
}
