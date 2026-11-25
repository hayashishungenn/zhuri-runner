/**
 * Renderer3D —— 真3D 第三人称渲染（规范要求的默认渲染器）。
 * 运行时构建，不依赖编辑器手工摆场景：
 * - 透视相机（第三人称背身追尾，SOLID_COLOR 清屏）
 * - 分段色带天空墙 + 星空 + 太阳 + 远山锥体（对应 P0 分段渐变美学）
 * - 跑道/车道虚线/障碍/阳炎/侧景 全部由 primitives 几何体 + builtin-unlit 纯色材质构成
 * - 程序化夸父剪影（躯干/四肢/发髻/桃木杖，跑动周期动画）
 * 只读核心状态；实体节点按需创建/回收（池化），透明材质不用于 3D 层（见 KNOWN_ISSUES）。
 */
import { Node, Camera, MeshRenderer, Material, Mesh, Color, Vec3, Layers, director, utils, primitives, DirectionalLight } from 'cc';
import { GameConfig } from '../config/GameConfigSchema';
import { GameCore } from '../core/GameCore';
import { AdService } from '../platform/AdService';
import { IRenderer } from './IRenderer';
import { Hud2D } from './Hud2D';
import { ScreenFx } from './ScreenFx';
import { Obstacle, Fragment, Prop } from '../core/types';

// ---------- 世界尺度（逻辑单位 → 3D 世界单位） ----------
const LANE_W3 = 1.7;        // 一车道宽度
const Z_SCALE = 0.55;       // 逻辑 z → 世界 z（远离玩家为负）
const HOP_U = 1.42;         // 跳跃高度（对应 P0 92px）

// ---------- 尺寸 ----------
const TRACK_HALF_W = 2.94;  // runwayHalf 190px
const TRACK_LEN = 30;
const DASH_STEP = 3.2;      // 同车道虚线间距
const DASH_PER_LANE = 9;
const DASH_COUNT = DASH_PER_LANE * 2;
const DASH_SPAN = DASH_PER_LANE * DASH_STEP;

interface Rec { kind: string; node: Node; }
interface Puff3 { node: Node; x: number; y: number; z: number; vx: number; vy: number; life: number; max: number; r: number; }

export class Renderer3D implements IRenderer {
    private cfg: GameConfig;
    private root3d!: Node;
    private camNode!: Node;
    private cam!: Camera;
    private fx = new ScreenFx();

    // 共享几何体
    private mBox!: Mesh; private mSphere!: Mesh; private mCone!: Mesh;
    private mCyl!: Mesh; private mQuad!: Mesh;
    private matCache = new Map<string, Material>();

    // 池
    private pools = new Map<string, Node[]>();
    private obRecs = new Map<Obstacle, Rec>();
    private fragRecs = new Map<Fragment, Rec>();
    private propRecs = new Map<Prop, Rec>();

    // 车道虚线
    private dashes: Node[] = [];

    // 夸父
    private kuafu!: Node;
    private kLegL!: Node; private kLegR!: Node; private kArmL!: Node; private kArmR!: Node;
    private kStaff!: Node; private kShadow!: Node; private kBody!: Node;

    // 尘土
    private puffs: Puff3[] = [];
    private puffPool: Node[] = [];
    private prevJumpT = -1;
    private prevSlideT = -1;

    constructor(cfg: GameConfig) {
        this.cfg = cfg;
        this.buildScene();
    }

    // ---------- 材质/几何 ----------
    private mat(rgb: [number, number, number]): Material {
        const key = rgb.join(',');
        let m = this.matCache.get(key);
        if (!m) {
            m = new Material();
            m.initialize({ effectName: 'builtin-unlit' });
            m.setProperty('mainColor', new Color(rgb[0], rgb[1], rgb[2], 255));
            this.matCache.set(key, m);
        }
        return m;
    }

    /** 独立材质实例（需要每帧改色/互相独立的对象，如天空色带） */
    private matUnique(rgb: [number, number, number]): Material {
        const m = new Material();
        m.initialize({ effectName: 'builtin-unlit' });
        m.setProperty('mainColor', new Color(rgb[0], rgb[1], rgb[2], 255));
        return m;
    }

    private node3d(parent: Node, name: string, mesh: Mesh, rgb: [number, number, number], uniqueMat = false): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.DEFAULT;
        n.setParent(parent);
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mesh;
        mr.material = uniqueMat ? this.matUnique(rgb) : this.mat(rgb);
        return n;
    }

    // ---------- 场景构建 ----------
    private buildScene() {
        this.mBox = utils.MeshUtils.createMesh(primitives.box());
        this.mSphere = utils.MeshUtils.createMesh(primitives.sphere(0.5, { segments: 12 }));
        this.mCone = utils.MeshUtils.createMesh(primitives.cone(0.5, 1, { radialSegments: 10 }));
        this.mCyl = utils.MeshUtils.createMesh(primitives.cylinder(0.5, 0.5, 1, { radialSegments: 8 }));
        this.mQuad = utils.MeshUtils.createMesh(primitives.quad());

        const scene = director.getScene()!;
        this.root3d = new Node('world3d');
        this.root3d.layer = Layers.Enum.DEFAULT;
        scene.addChild(this.root3d);

        // 相机：第三人称背身
        this.camNode = new Node('cam3d');
        this.camNode.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(this.camNode);
        this.cam = this.camNode.addComponent(Camera);
        this.cam.projection = Camera.ProjectionType.PERSPECTIVE;
        this.cam.fov = 58;
        this.cam.near = 0.3;
        this.cam.far = 600;
        this.cam.priority = 0;                      // 先于 UI 相机渲染
        this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.cam.clearColor = new Color(255, 154, 60, 255);
        this.camNode.setPosition(0, 4.1, 7.4);
        this.camNode.lookAt(new Vec3(0, 1.1, -3));

        // 平行光：当前材质全部 builtin-unlit（不参与光照），此光源为
        // P2 引入 builtin-standard 材质（真实明暗/阴影）预留，满足最小场景清单
        const lightNode = new Node('sunLight');
        lightNode.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(lightNode);
        const dirLight = lightNode.addComponent(DirectionalLight);
        dirLight.illuminance = 2.2;
        lightNode.setRotationFromEuler(-42, 118, 0);   // 源自画面左侧低角度落日方向

        this.buildSky();
        this.buildTrack();
        this.buildKuafu();
    }

    private buildSky() {
        // 分段色带天空墙（P0 渐变色板）
        const bands = 10;
        const H = 9, Y0 = 0, Z = -190;
        for (let i = 0; i < bands; i++) {
            const b = this.node3d(this.root3d, `sky${i}`, this.mQuad, [255, 255, 255], true);
            b.setPosition(0, Y0 + (i + 0.5) * H, Z);
            b.setScale(600, H, 1);
            this.skyBands.push({ node: b, t: i / (bands - 1) });
        }
        // 星星
        for (let i = 0; i < 30; i++) {
            const st = this.node3d(this.root3d, `star${i}`, this.mSphere, [255, 255, 255]);
            st.setPosition(((i * 137) % 240) - 120, 24 + ((i * 53) % 66), -170);
            const r = 0.25 + (i % 3) * 0.1;
            st.setScale(r, r, r);
            this.stars.push({ node: st, phase: i * 1.7, base: r });
        }
        // 太阳（球体 + 外层浅色晕环替代）
        const sun = this.node3d(this.root3d, 'sun', this.mSphere, [255, 217, 138]);
        sun.setPosition(0, 10, -160); sun.setScale(12, 12, 12);
        const halo = this.node3d(this.root3d, 'sunHalo', this.mSphere, [255, 170, 90]);
        halo.setPosition(0, 10, -160.5); halo.setScale(15.5, 15.5, 15.5);
        this.sunNodes.push(sun, halo);
        // 远山（两层锥体）
        const ridge1: [number, number, number][] = [[-70, 16, -150], [-30, 22, -160], [15, 18, -155], [55, 24, -165], [95, 15, -150]];
        const ridge2: [number, number, number][] = [[-100, 20, -135], [-55, 13, -128], [0, 16, -132], [45, 12, -126], [85, 19, -138]];
        for (const [x, h, z] of ridge1) {
            const m = this.node3d(this.root3d, 'mt1', this.mCone, [60, 22, 20]);
            m.setPosition(x, h / 2, z); m.setScale(h * 0.9, h, h * 0.9);
        }
        for (const [x, h, z] of ridge2) {
            const m = this.node3d(this.root3d, 'mt2', this.mCone, [40, 16, 14]);
            m.setPosition(x, h / 2, z); m.setScale(h * 0.9, h, h * 0.9);
        }
    }

    private skyBands: { node: Node; t: number }[] = [];
    private stars: { node: Node; phase: number; base: number }[] = [];
    private sunNodes: Node[] = [];

    private buildTrack() {
        // 地面
        const ground = this.node3d(this.root3d, 'ground', this.mBox, [45, 26, 15]);
        ground.setPosition(0, -0.15, -110); ground.setScale(500, 0.3, 280);
        // 跑道
        const track = this.node3d(this.root3d, 'track', this.mBox, [58, 34, 20]);
        track.setPosition(0, 0.01, -TRACK_LEN / 2 + 2.5); track.setScale(TRACK_HALF_W * 2, 0.1, TRACK_LEN);
        // 路缘
        for (const side of [-1, 1]) {
            const curb = this.node3d(this.root3d, 'curb', this.mBox, [255, 170, 90]);
            curb.setPosition(side * TRACK_HALF_W, 0.06, -TRACK_LEN / 2 + 2.5);
            curb.setScale(0.16, 0.14, TRACK_LEN);
        }
        // 车道虚线（动态滚动）
        for (let i = 0; i < DASH_COUNT; i++) {
            const d = this.node3d(this.root3d, 'dash', this.mBox, [255, 210, 140]);
            d.setScale(0.06, 0.02, 0.7);
            this.dashes.push(d);
        }
    }

    private buildKuafu() {
        const BODY: [number, number, number] = [26, 17, 10];
        this.kuafu = new Node('kuafu');
        this.kuafu.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(this.kuafu);
        // 躯干（胶囊感：圆柱+球）
        this.kBody = this.node3d(this.kuafu, 'torso', this.mCyl, BODY);
        this.kBody.setPosition(0, 0.78, 0); this.kBody.setScale(0.32, 0.62, 0.24);
        const chest = this.node3d(this.kuafu, 'chest', this.mSphere, BODY);
        chest.setPosition(0, 1.12, 0); chest.setScale(0.3, 0.3, 0.22);
        // 头 + 发髻
        const head = this.node3d(this.kuafu, 'head', this.mSphere, BODY);
        head.setPosition(0, 1.36, 0); head.setScale(0.38, 0.38, 0.38);
        const bun = this.node3d(this.kuafu, 'bun', this.mSphere, BODY);
        bun.setPosition(0, 1.6, -0.06); bun.setScale(0.17, 0.17, 0.17);
        // 四肢：枢轴在髋/肩，子节点下垂
        this.kLegL = this.limb('legL', 0.13, -0.13, 0.52, BODY);
        this.kLegR = this.limb('legR', 0.13, 0.13, 0.52, BODY);
        this.kArmL = this.limb('armL', 1.05, -0.2, 0.42, BODY);
        this.kArmR = this.limb('armR', 1.05, 0.2, 0.42, BODY);
        // 桃木杖（背后斜背）
        this.kStaff = this.node3d(this.kuafu, 'staff', this.mCyl, [74, 44, 24]);
        this.kStaff.setPosition(0, 1.0, -0.26);
        this.kStaff.setScale(0.07, 0.07, 1.15);
        this.kStaff.setRotationFromEuler(0, 0, 28);
        // 影子
        this.kShadow = this.node3d(this.root3d, 'kuafuShadow', this.mCyl, [12, 6, 3]);
        this.kShadow.setPosition(0, 0.02, 0); this.kShadow.setScale(0.8, 0.02, 0.8);
    }

    private limb(name: string, pivotY: number, x: number, len: number, rgb: [number, number, number]): Node {
        const pivot = new Node(name);
        pivot.layer = Layers.Enum.DEFAULT;
        pivot.setParent(this.kuafu);
        pivot.setPosition(x, pivotY, 0);
        const seg = this.node3d(pivot, 'seg', this.mCyl, rgb);
        seg.setPosition(0, -len / 2, 0);
        seg.setScale(0.16, len, 0.16);
        return pivot;
    }

    // ---------- 池化 ----------
    private acquire(kind: string): Node {
        const pool = this.pools.get(kind);
        const n = pool && pool.length ? pool.pop()! : this.createEntityNode(kind);
        n.setParent(this.root3d);
        return n;
    }
    private release(kind: string, n: Node) {
        n.setParent(null);
        let pool = this.pools.get(kind);
        if (!pool) { pool = []; this.pools.set(kind, pool); }
        pool.push(n);
    }
    private createEntityNode(kind: string): Node {
        // 约定：容器节点锚点在地面（y=0），几何体作为子节点摆放
        switch (kind) {
        case 'rock': {
            const n = new Node('rock');
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            const body = this.node3d(n, 'body', this.mBox, [58, 36, 20]);
            body.setPosition(0, 0.35, 0); body.setScale(1.2, 0.7, 0.9);
            const cap = this.node3d(n, 'cap', this.mCone, [80, 50, 30]);
            cap.setPosition(0, 0.9, 0); cap.setScale(0.7, 0.5, 0.55);
            return n;
        }
        case 'log': {
            const n = new Node('log');
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            for (const s of [-1, 1]) {
                const post = this.node3d(n, 'post', this.mBox, [44, 24, 13]);
                post.setPosition(s * 0.72, 0.35, 0); post.setScale(0.14, 0.7, 0.14);
            }
            const bar = this.node3d(n, 'bar', this.mBox, [64, 34, 15]);
            bar.setPosition(0, 0.78, 0); bar.setScale(1.6, 0.16, 0.2);
            const glow = this.node3d(n, 'glow', this.mBox, [255, 209, 102]);
            glow.setPosition(0, 0.96, 0); glow.setScale(1.5, 0.03, 0.12);
            return n;
        }
        case 'wall': {
            const n = new Node('wall');
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            const body = this.node3d(n, 'body', this.mBox, [51, 29, 16]);
            body.setPosition(0, 0.9, 0); body.setScale(1.6, 1.8, 0.5);
            return n;
        }
        case 'frag': {
            const n = new Node('frag');
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            const orb = this.node3d(n, 'orb', this.mSphere, [255, 209, 102]);
            orb.setScale(0.32, 0.32, 0.32);
            return n;
        }
        case 'tree': {
            const n = new Node('tree');
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            const trunk = this.node3d(n, 'trunk', this.mCyl, [29, 14, 8]);
            trunk.setPosition(0, 0.35, 0); trunk.setScale(0.22, 0.7, 0.22);
            const crown = this.node3d(n, 'crown', this.mCone, [29, 14, 8]);
            crown.setPosition(0, 1.25, 0); crown.setScale(1.6, 1.9, 1.6);
            return n;
        }
        case 'prock': {
            const n = new Node('prock');
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            const body = this.node3d(n, 'body', this.mBox, [40, 24, 14]);
            body.setPosition(0, 0.4, 0); body.setScale(0.8, 0.8, 0.8);
            return n;
        }
        default: throw new Error('未知实体类型: ' + kind);
        }
    }

    private obKind(t: string): string { return t; }
    private propKind(p: Prop): string { return p.kind === 'tree' ? 'tree' : 'prock'; }

    private syncEntities() {
        const core = this.core!;
        this.syncList(core.obstacles, this.obRecs, (o) => this.obKind(o.type));
        this.syncList(core.fragments.filter((f) => !f.got), this.fragRecs, () => 'frag');
        this.syncList(core.props, this.propRecs, (p) => this.propKind(p));
    }
    private syncList<T>(list: T[], recs: Map<T, Rec>, kindOf: (t: T) => string) {
        const seen = new Set<T>();
        for (const e of list) {
            seen.add(e);
            if (!recs.has(e)) recs.set(e, { kind: kindOf(e), node: this.acquire(kindOf(e)) });
        }
        for (const [e, rec] of recs) {
            if (!seen.has(e)) { this.release(rec.kind, rec.node); recs.delete(e); }
        }
    }

    // ---------- 主渲染 ----------
    private core: GameCore | null = null;

    render(core: GameCore, _ad: AdService, dt: number, hud: Hud2D) {
        this.core = core;
        this.dt = dt;
        this.fx.update(dt, core.state, core.timeScale);
        const fdt = core.state === 'dying' ? dt * core.timeScale : dt;
        this.trackJumps(core);
        this.updatePuffs(fdt);
        this.syncEntities();
        this.placeEntities(core);
        this.placeKuafu(core);
        this.updateSky(core);
        this.updateDashes(core);
        this.updateCamera(core);
        hud.render(core, _ad, this.fx.slowAmt(core.timeScale), this.fx.redFlash);
    }
    private dt = 0.016;

    onCoreEvents(events: ReturnType<GameCore['drainEvents']>) {
        this.fx.onEvents(events);
        for (const e of events) {
            if (e.type === 'crash') this.burst();
            else if (e.type === 'fragment') this.dust();
        }
    }

    destroy() {
        this.root3d?.destroy();
        this.matCache.clear();
    }

    // ---------- 摆放 ----------
    private placeEntities(core: GameCore) {
        for (const [o, rec] of this.obRecs) {
            rec.node.setPosition(o.lane * LANE_W3, 0, -o.z * Z_SCALE);
        }
        for (const [f, rec] of this.fragRecs) {
            const s = 0.32 * (1 + Math.sin(core.gTime * 5 + f.z) * 0.12);
            rec.node.setPosition(f.lane * LANE_W3, 0.85 + Math.sin(core.gTime * 3 + f.z) * 0.08, -f.z * Z_SCALE);
            rec.node.setScale(s, s, s);
        }
        for (const [p, rec] of this.propRecs) {
            const sway = Math.sin(core.gTime * 1.6 + p.sway) * 0.02;
            rec.node.setPosition(p.x * LANE_W3, 0, -p.z * Z_SCALE);
            rec.node.setScale(p.s, p.s, p.s);
            rec.node.setRotationFromEuler(0, 0, sway * 60);
        }
    }

    private placeKuafu(core: GameCore) {
        const px = core.playerLaneF * LANE_W3;
        const air = core.jumpT >= 0;
        const hop = air ? Math.sin(core.jumpT * Math.PI) * HOP_U : 0;
        const sliding = core.slideT >= 0;
        this.kuafu.setPosition(px, hop, 0);
        this.kuafu.setRotationFromEuler(sliding ? -55 : 0, 0, 0);
        this.kuafu.setScale(1, sliding ? 0.62 : 1, 1);
        // 跑动周期
        const swing = air ? 0.5 : Math.sin(core.runPhase) * 0.6;
        this.kLegL.setRotationFromEuler(swing * 57.3, 0, 0);
        this.kLegR.setRotationFromEuler(-swing * 57.3, 0, 0);
        this.kArmL.setRotationFromEuler(-swing * 57.3, 0, 0);
        this.kArmR.setRotationFromEuler(swing * 57.3, 0, 0);
        this.kStaff.setRotationFromEuler(0, 0, 28 + Math.sin(core.runPhase) * 3);
        // 无敌闪烁（3D 层无透明材质，以显隐替代 P0 半透明闪烁）
        this.kuafu.active = !(core.invincible > 0 && Math.floor(core.gTime * 10) % 2 === 0);
        // 影子
        this.kShadow.setPosition(px, 0.02, 0);
        const ss = Math.max(0.3, 1 - hop * 0.5);
        this.kShadow.setScale(0.8 * ss, 0.02, 0.8 * ss);
        // 尘土生成位置跟随
        this.playerX = px;
    }
    private playerX = 0;

    private trackJumps(core: GameCore) {
        if (this.prevJumpT < 0 && core.jumpT >= 0) this.dust();
        if (this.prevJumpT >= 0 && core.jumpT < 0) this.dust();
        if (this.prevSlideT < 0 && core.slideT >= 0) this.dust();
        this.prevJumpT = core.jumpT;
        this.prevSlideT = core.slideT;
    }

    // ---------- 尘土 ----------
    private dust() {
        for (let i = 0; i < 6; i++) {
            const node = this.puffPool.pop() ?? this.node3d(this.root3d, 'puff', this.mSphere, [138, 106, 72]);
            const r = 0.06 + Math.random() * 0.08;
            node.setScale(r, r, r);
            this.puffs.push({
                node,
                x: this.playerX + (Math.random() - 0.5) * 0.5, y: 0.1, z: 0.2 + Math.random() * 0.3,
                vx: (Math.random() - 0.5) * 0.8, vy: 0.6 + Math.random() * 0.9,
                life: 0, max: 0.5 + Math.random() * 0.3, r,
            });
        }
    }
    private burst() {
        for (let i = 0; i < 14; i++) {
            const node = this.puffPool.pop() ?? this.node3d(this.root3d, 'puff', this.mSphere, [138, 106, 72]);
            const r = 0.08 + Math.random() * 0.12;
            node.setScale(r, r, r);
            this.puffs.push({
                node,
                x: this.playerX + (Math.random() - 0.5) * 0.8, y: 0.2 + Math.random() * 0.4, z: 0.1 + Math.random() * 0.5,
                vx: (Math.random() - 0.5) * 2.4, vy: 1.2 + Math.random() * 1.6,
                life: 0, max: 0.7, r,
            });
        }
    }
    private updatePuffs(dt: number) {
        for (let i = this.puffs.length - 1; i >= 0; i--) {
            const q = this.puffs[i];
            q.life += dt;
            if (q.life > q.max) {
                q.node.setParent(null);
                this.puffPool.push(q.node);
                this.puffs.splice(i, 1);
                continue;
            }
            q.x += q.vx * dt; q.y += q.vy * dt; q.vy -= 2.2 * dt;
            q.node.setPosition(q.x, q.y, q.z);
        }
    }

    // ---------- 天空/虚线/相机 ----------
    private updateSky(core: GameCore) {
        const p = core.skyP;
        const mix = (a: number[], b: number[], t: number) => [
            a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        // P0 天空三段渐变色板
        const seg = (t: number): number[] => {
            if (t < 0.45) return mix([25, 18, 51], mix([90, 32, 40], [70, 40, 80], p), t / 0.45);
            if (t < 0.8) return mix(mix([90, 32, 40], [70, 40, 80], p), mix([196, 78, 36], [160, 60, 44], p), (t - 0.45) / 0.35);
            return mix(mix([196, 78, 36], [160, 60, 44], p), mix([255, 154, 60], [255, 130, 60], p), (t - 0.8) / 0.2);
        };
        for (const b of this.skyBands) {
            const c = seg(b.t);
            b.node.getComponent(MeshRenderer)!.material!.setProperty('mainColor', new Color(c[0], c[1], c[2], 255));
        }
        const twinkle = (phase: number) => 0.55 + 0.45 * Math.sin(core.gTime * 2 + phase);
        for (const s of this.stars) {
            const k = s.base * (0.6 + 0.6 * twinkle(s.phase)) * (1 - p * 0.8);   // 天亮星隐
            s.node.setScale(k, k, k);
        }
        const sunScale = 12 + p * 10;
        this.sunNodes[0].setScale(sunScale, sunScale, sunScale);
        this.sunNodes[1].setScale(sunScale * 1.3, sunScale * 1.3, sunScale * 1.3);
        this.cam.clearColor = new Color(
            Math.round(seg(1)[0]), Math.round(seg(1)[1]), Math.round(seg(1)[2]), 255);
    }

    private updateDashes(core: GameCore) {
        const scroll = (core.gTime * core.speed * Z_SCALE) % DASH_STEP;
        for (let i = 0; i < DASH_COUNT; i++) {
            const d = this.dashes[i];
            const k = Math.floor(i / 2);
            let z = 1 - k * DASH_STEP - scroll;
            if (z < 1 - DASH_SPAN) z += DASH_SPAN;
            d.setPosition(i % 2 === 0 ? -0.85 : 0.85, 0.07, z);
        }
    }

    private updateCamera(core: GameCore) {
        const targetX = core.playerLaneF * LANE_W3 * 0.45;
        const cur = this.camNode.position;
        const nx = cur.x + (targetX - cur.x) * Math.min(1, this.dt * 8);
        const shake = this.fx.shake > 0.3 ? this.fx.shake * 0.012 : 0;
        this.camNode.setPosition(
            nx + (Math.random() - 0.5) * shake,
            4.1 + (Math.random() - 0.5) * shake,
            7.4,
        );
        this.camNode.lookAt(new Vec3(core.playerLaneF * LANE_W3 * 0.6, 1.1, -3));
    }
}
