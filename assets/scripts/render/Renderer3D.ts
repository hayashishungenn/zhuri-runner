/**
 * Renderer3D —— 真3D 第三人称渲染（默认渲染器）。Phase 2：无限地图版。
 *
 * - 世界空间由核心层 SegmentPath 承载（直/弧/坡/桥/崖/洞）；本层所有摆放经 path.sample
 * - 分段跑道：每 Segment 一条 ribbon 网格（沿中心线采样左右边线），随生成/回收同步
 * - 世界原点重定位：WorldShift 阈值重定位，全场景 render = abs − shift（float32 精度防护）
 * - 天空锚点跟随玩家位置与航向（色带/星空/太阳/远山永远"在远方"）
 * - 相机：路径后方跟随（位置插值、跳跃高度跟随、速度 fov、震屏上限、转弯自然摇移）
 * - 角色动画经 CharacterAnimator 接口；实体池化；透明材质不用于 3D 层
 */
import { Node, Camera, MeshRenderer, Material, Mesh, Color, Vec3, Layers, director, utils, primitives, DirectionalLight } from 'cc';
import { GameConfig } from '../config/GameConfigSchema';
import { GameCore } from '../core/GameCore';
import { AdService } from '../platform/AdService';
import { IRenderer } from './IRenderer';
import { Hud2D } from './Hud2D';
import { ScreenFx } from './ScreenFx';
import { Obstacle, Fragment, Prop, ItemEntity, ItemKind } from '../core/types';
import { TrackSegment, PathSample } from '../core/track';
import { ObstacleCatalog, ObstacleDef } from '../config/ObstacleCatalog';
import { CharAnimState } from './CharacterAnimator';
import { ProceduralKuafu } from './ProceduralKuafu';
import { WorldShift } from '../core/WorldShift';

/** 道具颜色（神通/道具统一配色） */
const ITEM_TINT: Record<ItemKind, [number, number, number]> = {
    magnet: [58, 160, 255], shield: [255, 213, 74], dash: [255, 83, 64],
    double: [178, 106, 255], water: [64, 208, 192],
    staff: [184, 122, 62], leap: [120, 220, 130],
};


// ---------- 世界尺度 ----------
const LANE_W3 = 1.7;
const CAM_Y = 4.1;
/** 相机在玩家后方的路径距离（逻辑单位）：世界 7.4 / Z_SCALE 0.55 */
const CAM_BACK_D = 13.4;
const LOOK_Y = 1.1;
const BEHIND_HIDE_Z = 0.5;
const DEG = 57.29578;



const DASH_STEP = 3.2;
const DASH_PER_LANE = 9;
const DASH_COUNT = DASH_PER_LANE * 2;

interface Rec { kind: string; node: Node; }
interface Puff3 { node: Node; x: number; y: number; z: number; vx: number; vy: number; life: number; max: number; }

/** 分段跑道视图：ribbon 网格 + 特殊地块装饰（桥墩/洞拱/崖栏/过渡牌） */
interface SegView { node: Node; mesh: Mesh | null; decors: Node[]; }

export class Renderer3D implements IRenderer {
    private cfg: GameConfig;
    private root3d!: Node;
    private camNode!: Node;
    private cam!: Camera;
    private fx = new ScreenFx();
    private world = new WorldShift();

    private mBox!: Mesh; private mSphere!: Mesh; private mCone!: Mesh;
    private mCyl!: Mesh; private mQuad!: Mesh;
    private matCache = new Map<string, Material>();

    private pools = new Map<string, Node[]>();
    private obRecs = new Map<Obstacle, Rec>();
    private fragRecs = new Map<Fragment, Rec>();
    private propRecs = new Map<Prop, Rec>();

    private dashes: Node[] = [];
    private skyAnchor!: Node;
    private ground!: Node;
    private skyBands: { node: Node; t: number }[] = [];
    private stars: { node: Node; phase: number; base: number }[] = [];
    private sunNodes: Node[] = [];

    private kuafu!: ProceduralKuafu;
    private segViews = new Map<TrackSegment, SegView>();
    private segNodePool: Node[] = [];
    private decorPools = new Map<string, Node[]>();

    private puffs: Puff3[] = [];
    private puffPool: Node[] = [];

    private core: GameCore | null = null;
    private dt = 0.016;
    private playerX = 0;
    private catalog: ObstacleCatalog;
    private defMap = new Map<string, ObstacleDef>();

    constructor(cfg: GameConfig, catalog: ObstacleCatalog) {
        this.cfg = cfg;
        this.catalog = catalog;
        for (const d of catalog.obstacles) this.defMap.set(d.id, d);
        this.buildScene();
    }

    // ---------- 材质/几何 ----------
    private mat(key: string, rgb: [number, number, number]): Material {
        let m = this.matCache.get(key);
        if (!m) {
            m = new Material();
            m.initialize({ effectName: 'builtin-unlit' });
            m.setProperty('mainColor', new Color(rgb[0], rgb[1], rgb[2], 255));
            this.matCache.set(key, m);
        }
        return m;
    }

    private node3d(parent: Node, name: string, mesh: Mesh, rgb: [number, number, number], matKey?: string): Node {
        const n = new Node(name);
        n.layer = Layers.Enum.DEFAULT;
        n.setParent(parent);
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = mesh;
        mr.material = this.mat(matKey ?? rgb.join(','), rgb);
        return n;
    }

    private makePart = (parent: Node, name: string, kind: 'box' | 'sphere' | 'cyl' | 'cone', rgb: [number, number, number]): Node => {
        const mesh = kind === 'box' ? this.mBox : kind === 'sphere' ? this.mSphere : kind === 'cone' ? this.mCone : this.mCyl;
        return this.node3d(parent, name, mesh, rgb);
    };

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

        this.camNode = new Node('cam3d');
        this.camNode.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(this.camNode);
        this.cam = this.camNode.addComponent(Camera);
        this.cam.projection = Camera.ProjectionType.PERSPECTIVE;
        this.cam.fov = this.cfg.camera.fovBase;
        this.cam.near = 0.3;
        this.cam.far = 600;
        this.cam.priority = 0;
        this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.cam.clearColor = new Color(255, 154, 60, 255);
        this.camNode.setPosition(0, CAM_Y, 7.4);
        this.camNode.lookAt(new Vec3(0, LOOK_Y, -3));

        const lightNode = new Node('sunLight');
        lightNode.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(lightNode);
        const dirLight = lightNode.addComponent(DirectionalLight);
        dirLight.illuminance = 2.2;
        lightNode.setRotationFromEuler(-42, 118, 0);

        this.skyAnchor = new Node('skyAnchor');
        this.skyAnchor.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(this.skyAnchor);
        this.buildSky(this.skyAnchor);
        this.buildGround();
        this.buildDashes();
        this.kuafu = new ProceduralKuafu(this.makePart, this.root3d);
    }

    private buildSky(anchor: Node) {
        const bands = 10;
        const H = 9, Y0 = -2, Z = -190;
        for (let i = 0; i < bands; i++) {
            const b = this.node3d(anchor, `sky${i}`, this.mQuad, [255, 255, 255], `sky${i}`);
            b.setPosition(0, Y0 + (i + 0.5) * H, Z);
            b.setScale(600, H, 1);
            this.skyBands.push({ node: b, t: i / (bands - 1) });
        }
        for (let i = 0; i < 30; i++) {
            const st = this.node3d(anchor, `star${i}`, this.mSphere, [255, 255, 255]);
            st.setPosition(((i * 137) % 240) - 120, 24 + ((i * 53) % 66), -170);
            const r = 0.25 + (i % 3) * 0.1;
            st.setScale(r, r, r);
            this.stars.push({ node: st, phase: i * 1.7, base: r });
        }
        const sun = this.node3d(anchor, 'sun', this.mSphere, [255, 217, 138], 'sun');
        sun.setPosition(0, 10, -160); sun.setScale(12, 12, 12);
        const halo = this.node3d(anchor, 'sunHalo', this.mSphere, [255, 170, 90], 'halo');
        halo.setPosition(0, 10, -160.5); halo.setScale(15.5, 15.5, 15.5);
        this.sunNodes.push(sun, halo);
        const ridge1: [number, number, number][] = [[-70, 16, -150], [-30, 22, -160], [15, 18, -155], [55, 24, -165], [95, 15, -150]];
        const ridge2: [number, number, number][] = [[-100, 20, -135], [-55, 13, -128], [0, 16, -132], [45, 12, -126], [85, 19, -138]];
        for (const [x, h, z] of ridge1) {
            const m = this.node3d(anchor, 'mt1', this.mCone, [60, 22, 20], 'mt1');
            m.setPosition(x, h / 2, z); m.setScale(h * 0.9, h, h * 0.9);
        }
        for (const [x, h, z] of ridge2) {
            const m = this.node3d(anchor, 'mt2', this.mCone, [40, 16, 14], 'mt2');
            m.setPosition(x, h / 2, z); m.setScale(h * 0.9, h, h * 0.9);
        }
    }

    private buildGround() {
        this.ground = this.node3d(this.root3d, 'ground', this.mBox, [45, 26, 15], 'ground');
        this.ground.setPosition(0, -0.15, -110);
        this.ground.setScale(500, 0.3, 280);
    }

    private buildDashes() {
        for (let i = 0; i < DASH_COUNT; i++) {
            const d = this.node3d(this.root3d, 'dash', this.mBox, [255, 210, 140], 'dash');
            d.setScale(0.06, 0.02, 0.7);
            this.dashes.push(d);
        }
    }

    // ---------- 分段跑道视图 ----------
    private releaseDecor(kind: string, n: Node) {
        n.setParent(null);
        let pool = this.decorPools.get(kind);
        if (!pool) { pool = []; this.decorPools.set(kind, pool); }
        pool.push(n);
    }
    private acquireDecor(kind: string, rgb: [number, number, number]): Node {
        const pool = this.decorPools.get(kind);
        if (pool && pool.length) { const n = pool.pop()!; n.setParent(this.root3d); return n; }
        const mesh = kind === 'post' ? this.mBox : this.mCyl;
        return this.node3d(this.root3d, kind, mesh, rgb, kind);
    }

    private releaseSegView(view: SegView) {
        for (const d of view.decors) this.releaseDecor(d.name, d);
        view.decors.length = 0;
        if (view.mesh) { view.mesh.destroy(); view.mesh = null; }
        view.node.setParent(null);
        this.segNodePool.push(view.node);
    }

    private acquireSegNode(): Node {
        const n = this.segNodePool.pop();
        if (n) { n.setParent(this.root3d); return n; }
        const nn = new Node('seg');
        nn.layer = Layers.Enum.DEFAULT;
        this.root3d.addChild(nn);
        return nn;
    }

    /** 沿地块中心线构建路面 ribbon 网格（顶点相对地块入口，配合 shift 放置） */
    private buildRibbonMesh(seg: TrackSegment): Mesh {
        const path = this.core!.path;
        const n = Math.max(6, Math.ceil(seg.length / 2));
        const positions: number[] = [];
        const indices: number[] = [];
        const ex = seg.entry.x, ey = seg.entry.y, ez = seg.entry.z;
        for (let i = 0; i <= n; i++) {
            const p = path.sample(seg.startD + seg.length * (i / n), 0);
            const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
            const hw = seg.halfWidth;
            positions.push(p.x - rx * hw - ex, p.y + 0.02 - ey, p.z - rz * hw - ez);
            positions.push(p.x + rx * hw - ex, p.y + 0.02 - ey, p.z + rz * hw - ez);
            if (i > 0) {
                const a = (i - 1) * 2;
                indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
        }
        return utils.MeshUtils.createMesh({ positions, indices } as never);
    }

    /** 边缘窄带（路缘）：laneOffset 处宽 w 的条带 */
    private buildEdgeRibbon(seg: TrackSegment, laneOffset: number, w: number): Mesh {
        const path = this.core!.path;
        const n = Math.max(6, Math.ceil(seg.length / 2));
        const positions: number[] = [];
        const indices: number[] = [];
        const ex = seg.entry.x, ey = seg.entry.y, ez = seg.entry.z;
        for (let i = 0; i <= n; i++) {
            const p = path.sample(seg.startD + seg.length * (i / n), laneOffset);
            const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
            positions.push(p.x - rx * w - ex, p.y + 0.03 - ey, p.z - rz * w - ez);
            positions.push(p.x + rx * w - ex, p.y + 0.03 - ey, p.z + rz * w - ez);
            if (i > 0) {
                const a = (i - 1) * 2;
                indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
        }
        return utils.MeshUtils.createMesh({ positions, indices } as never);
    }

    private createSegView(seg: TrackSegment): SegView {
        const path = this.core!.path;
        const node = this.acquireSegNode();
        const view: SegView = { node, mesh: null, decors: [] };
        // ribbon（主题配色）
        const ribbon = new Node('ribbon');
        ribbon.layer = Layers.Enum.DEFAULT;
        ribbon.setParent(node);
        const mr = ribbon.addComponent(MeshRenderer);
        view.mesh = this.buildRibbonMesh(seg);
        mr.mesh = view.mesh;
        const theme = seg.theme % this.cfg.themes.length;
        const tt = this.cfg.themes[theme].trackTint;
        mr.material = this.mat(`ribbon${theme}`, tt);
        const entryR = this.world.toRender(seg.entry);
        node.setPosition(entryR.x, entryR.y, entryR.z);

        // 路缘条（两侧窄带）
        for (const side of [-1, 1]) {
            const curb = new Node(`curb${side}`);
            curb.layer = Layers.Enum.DEFAULT;
            curb.setParent(node);
            const cmr = curb.addComponent(MeshRenderer);
            cmr.mesh = this.buildEdgeRibbon(seg, side * (seg.halfWidth + 0.12), 0.16);
            cmr.material = this.mat(`curb${theme}`, this.cfg.themes[theme].curbTint);
        }

        // 特殊地块装饰（位置相对入口）
        const addDecor = (kind: string, rgb: [number, number, number], dAbs: number, lane: number,
            place: (n: Node, p: PathSample, dy: number) => void) => {
            const dn = this.acquireDecor(kind, rgb);
            dn.setParent(node);
            const p = path.sample(dAbs, lane);
            dn.setRotationFromEuler(0, p.heading * DEG, 0);
            const dx = p.x - seg.entry.x, dy = p.y - seg.entry.y, dz = p.z - seg.entry.z;
            place(dn, p, dy);
            dn.setPosition(dx, dy, dz);
            view.decors.push(dn);
        };

        if (seg.kind === 'bridge') {
            const steps = Math.max(2, Math.round(seg.length / 8));
            for (let i = 0; i <= steps; i++) {
                const dAbs = seg.startD + (seg.length * i) / steps;
                for (const side of [-1, 1]) {
                    addDecor('pillar', [46, 30, 18], dAbs, side * (seg.halfWidth - 0.15), (n, p, dy) => {
                        const h = (p.y + 0.3) / 1;
                        n.setScale(0.22, h, 0.22);
                        n.setPosition(0, -h / 2, 0);   // 桥墩落到地面（相对地块面）
                        void dy;
                    });
                }
            }
        } else if (seg.kind === 'cave') {
            const steps = Math.max(2, Math.round(seg.length / 6));
            for (let i = 0; i <= steps; i++) {
                const dAbs = seg.startD + (seg.length * i) / steps;
                addDecor('arch', [30, 16, 12], dAbs, 0, (n, _p, dy) => {
                    n.setScale(seg.halfWidth * 2 + 0.6, 0.5, 0.5);
                    n.setPosition(0, dy + 2.6, 0);
                });
            }
        } else if (seg.kind === 'cliff') {
            const steps = Math.max(2, Math.round(seg.length / 6));
            for (let i = 0; i <= steps; i++) {
                const dAbs = seg.startD + (seg.length * i) / steps;
                addDecor('post', [70, 42, 26], dAbs, seg.halfWidth, (n, _p, dy) => {
                    n.setScale(0.18, 0.9, 0.18);
                    n.setPosition(0, dy + 0.45, 0);
                });
            }
        } else if (seg.kind === 'transition') {
            const mid = seg.startD + seg.length / 2;
            addDecor('banner', [120, 60, 40], mid, 0, (n, _p, dy) => {
                n.setScale(seg.halfWidth * 2, 0.5, 0.3);
                n.setPosition(0, dy + 2.8, 0);
            });
            for (const side of [-1, 1]) {
                addDecor('pillar', [90, 50, 30], mid, side * (seg.halfWidth + 0.2), (n, _p, dy) => {
                    n.setScale(0.2, 2.8, 0.2);
                    n.setPosition(0, dy + 1.4, 0);
                });
            }
        }
        return view;
    }

    private updateSegViews() {
        const segs = this.core!.path.segments;
        for (const [seg, view] of this.segViews) {
            if (segs.indexOf(seg) < 0) { this.releaseSegView(view); this.segViews.delete(seg); }
        }
        for (const seg of segs) {
            if (!this.segViews.has(seg)) this.segViews.set(seg, this.createSegView(seg));
        }
    }

    // ---------- 池化实体 ----------
    private acquire(kind: string): Node {
        const pool = this.pools.get(kind);
        const n = pool && pool.length ? pool.pop()! : this.createEntityNode(kind);
        n.setParent(this.root3d);
        n.active = true;
        return n;
    }
    private release(kind: string, n: Node) {
        n.setParent(null);
        let pool = this.pools.get(kind);
        if (!pool) { pool = []; this.pools.set(kind, pool); }
        pool.push(n);
    }
    /** 实体节点工厂：障碍按目录 defId（vis 形态+配色+尺寸参数化），其余为场景实体/道具 */
    private createEntityNode(key: string): Node {
        const def = this.defMap.get(key);
        if (def) return this.createObstacleNode(def);
        switch (key) {
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
        default: {
            // 道具：发光球体（配色区分，旋转由摆放驱动）
            const n = new Node(key);
            n.layer = Layers.Enum.DEFAULT;
            n.setParent(this.root3d);
            const rgb = ITEM_TINT[key as ItemKind] ?? [255, 255, 255];
            const orb = this.node3d(n, 'orb', this.mSphere, rgb, `item_${key}`);
            orb.setScale(0.36, 0.36, 0.36);
            return n;
        }
        }
    }

    /** 障碍形态工厂（vis 基元组合，宽度/高度按占道数与 scale 参数化） */
    private createObstacleNode(def: ObstacleDef): Node {
        const S = def.scale ?? 1;
        const W = 0.9 + def.lanes * 0.75;   // 视觉宽度（世界单位）
        const rgb = def.tint;
        const n = new Node(def.id);
        n.layer = Layers.Enum.DEFAULT;
        n.setParent(this.root3d);
        const addBox = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: [number, number, number] = rgb) => {
            const b = this.node3d(n, name, this.mBox, c);
            b.setPosition(x, y, z);
            b.setScale(sx, sy, sz);
            return b;
        };
        const addCone = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: [number, number, number] = rgb) => {
            const b = this.node3d(n, name, this.mCone, c);
            b.setPosition(x, y, z);
            b.setScale(sx, sy, sz);
            return b;
        };
        const addCyl = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: [number, number, number] = rgb) => {
            const b = this.node3d(n, name, this.mCyl, c);
            b.setPosition(x, y, z);
            b.setScale(sx, sy, sz);
            return b;
        };
        const addSphere = (name: string, x: number, y: number, z: number, s: number, c: [number, number, number] = rgb) => {
            const b = this.node3d(n, name, this.mSphere, c);
            b.setPosition(x, y, z);
            b.setScale(s, s, s);
            return b;
        };

        switch (def.vis) {
        case 'rock':       // 石堆（jump）：主体箱 + 尖顶
            addBox('body', 0, 0.35 * S, 0, 1.1 * S, 0.7 * S, 0.9 * S);
            addCone('cap', 0, 0.9 * S, 0, 0.7 * S, 0.55 * S, 0.6 * S);
            break;
        case 'log':        // 倒木（jump）：横卧圆柱
            addCyl('trunk', 0, 0.3 * S, 0, 0.5 * S, 0.8 * W, 0.5 * S);
            break;
        case 'beam':       // 低梁/摆木（slide/摆动）：双支柱 + 横梁 + 顶亮条
            for (const side of [-1, 1]) addBox('post', side * W * 0.45, 0.35, 0, 0.14, 0.7, 0.14);
            addBox('bar', 0, 0.78, 0, W, 0.16, 0.2);
            addBox('glow', 0, 0.96, 0, W * 0.94, 0.03, 0.12, [255, 209, 102]);
            break;
        case 'wall':       // 墙类（lane）：高墙 + 沿口
            addBox('body', 0, 0.9, 0, W * 1.05, 1.8, 0.5);
            addBox('top', 0, 1.86, 0, W * 1.1, 0.14, 0.56);
            break;
        case 'arch':       // 拱门（slide 必须低头）：门柱 + 低顶梁
            for (const side of [-1, 1]) addBox('pillar', side * W * 0.5, 0.75, 0, 0.3, 1.5, 0.4);
            addBox('lintel', 0, 1.55, 0, W * 1.1, 0.4, 0.45);
            break;
        case 'gap':        // 沟壑（jump 跨越）：暗渊平面 + 边缘警示
            addBox('void', 0, 0.005, 0, W * 1.05, 0.02, 1.6, [16, 9, 5]);
            addBox('edge1', 0, 0.06, -0.8, W * 1.05, 0.08, 0.12, [200, 150, 90]);
            addBox('edge2', 0, 0.06, 0.8, W * 1.05, 0.08, 0.12, [200, 150, 90]);
            break;
        case 'water':      // 溪流（jump 跨越）：水面带
            addBox('surface', 0, 0.04, 0, W * 1.05, 0.05, 1.4, [70, 140, 170]);
            addBox('foam1', 0, 0.06, -0.7, W * 1.05, 0.04, 0.14, [200, 230, 240]);
            addBox('foam2', 0, 0.06, 0.7, W * 1.05, 0.04, 0.14, [200, 230, 240]);
            break;
        case 'fire':       // 火焰/火墙：火锥群 + 底座
            addBox('base', 0, 0.05, 0, W, 0.08, 0.8, [70, 30, 16]);
            for (let i = 0; i < 3; i++) {
                const off = (i - 1) * W * 0.3;
                addCone('flame' + i, off, 0.5 * S, 0, 0.4, 1.0 * S, 0.4);
            }
            break;
        case 'fence':      // 栅栏（lane）：竖条阵列 + 顶梁
            for (let i = 0; i < 4; i++) {
                addBox('slat' + i, -W * 0.4 + i * (W * 0.8 / 3), 0.7, 0, 0.14, 1.4, 0.14);
            }
            addBox('top', 0, 1.45, 0, W * 1.05, 0.12, 0.16);
            break;
        case 'vine':       // 藤蔓（jump）：贴地绿障
            addBox('base', 0, 0.12, 0, W, 0.22, 0.5, [70, 110, 46]);
            for (let i = 0; i < 3; i++) {
                addCyl('stalk' + i, -W * 0.3 + i * (W * 0.3), 0.3, 0, 0.08, 0.6, 0.08, [60, 96, 40]);
            }
            break;
        case 'bridge':     // 断桥（jump 跨越）：断裂板
            addBox('plank1', -W * 0.3, 0.1, -0.4, W * 0.4, 0.16, 0.7, [78, 50, 30]);
            addBox('plank2', W * 0.35, 0.06, 0.35, W * 0.35, 0.14, 0.6, [66, 42, 26]);
            break;
        case 'roller':     // 滚石（时机跳跃）：大圆石
            addSphere('ball', 0, 0.62, 0, 1.24);
            break;
        default:
            addBox('body', 0, 0.5, 0, W, 1.0, 0.5);
        }
        return n;
    }

    private syncEntities() {
        const core = this.core!;
        this.syncList(core.obstacles, this.obRecs, (o) => o.defId);
        this.syncList(core.fragments.filter((f) => !f.got), this.fragRecs, () => 'frag');
        this.syncList(core.items.filter((x) => !x.got), this.itemRecs, (x) => x.kind);
        this.syncList(core.props, this.propRecs, (p) => (p.kind === 'tree' ? 'tree' : 'prock'));
    }
    private itemRecs = new Map<ItemEntity, Rec>();
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
    render(core: GameCore, _ad: AdService, dt: number, hud: Hud2D) {
        this.core = core;
        this.dt = dt;
        this.fx.update(dt, core.state, core.timeScale);
        this.updatePuffs(dt * (core.state === 'dying' ? core.timeScale : 1));
        this.updateSegViews();
        this.syncEntities();
        this.placeEntities(core);
        this.placeKuafu(core);
        this.updateSky(core);
        this.updateDashes(core);
        this.updateCamera(core);
        hud.render(core, _ad, this.fx.slowAmt(core.timeScale), this.fx.redFlash);
    }

    onCoreEvents(events: ReturnType<GameCore['drainEvents']>) {
        this.fx.onEvents(events);
        for (const e of events) {
            if (e.type === 'crash') this.burst();
            else if (e.type === 'fragment' || e.type === 'jump' || e.type === 'land' || e.type === 'slideStart' || e.type === 'stumble') this.dust();
        }
    }

    destroy() {
        for (const [, view] of this.segViews) {
            if (view.mesh) view.mesh.destroy();
        }
        this.kuafu.destroy();
        this.root3d?.destroy();
        this.matCache.clear();
    }

    // ---------- 摆放（全部经 path.sample + WorldShift） ----------
    private placeEntities(core: GameCore) {
        for (const [o, rec] of this.obRecs) {
            const lx = o.visLane ?? o.lane;
            const p = core.path.sample(core.dist + o.z, lx * LANE_W3);
            const r = this.world.toRender(p);
            rec.node.setPosition(r.x, r.y, r.z);
            rec.node.setRotationFromEuler(0, p.heading * DEG, 0);
            rec.node.active = o.z > BEHIND_HIDE_Z;
        }
        for (const [it, rec] of this.itemRecs) {
            const p = core.path.sample(core.dist + it.z, it.lane * LANE_W3);
            const r = this.world.toRender(p);
            const bob = Math.sin(core.gTime * 4 + it.z) * 0.08;
            rec.node.setPosition(r.x, r.y + 0.9 + bob, r.z);
            rec.node.setScale(0.36, 0.36, 0.36);
            rec.node.setRotationFromEuler(0, core.gTime * 90, 0);
            rec.node.active = it.z > BEHIND_HIDE_Z;
        }
        for (const [f, rec] of this.fragRecs) {
            const p = core.path.sample(core.dist + f.z, f.lane * LANE_W3);
            const r = this.world.toRender(p);
            const sz = 0.32 * (1 + Math.sin(core.gTime * 5 + f.z) * 0.12);
            rec.node.setPosition(r.x, r.y + 0.85 + Math.sin(core.gTime * 3 + f.z) * 0.08, r.z);
            rec.node.setScale(sz, sz, sz);
            rec.node.active = f.z > BEHIND_HIDE_Z;
        }
        for (const [pp, rec] of this.propRecs) {
            const p = core.path.sample(core.dist + pp.z, pp.x * LANE_W3);
            const r = this.world.toRender(p);
            const sway = Math.sin(core.gTime * 1.6 + pp.sway) * 0.02;
            rec.node.setPosition(r.x, r.y, r.z);
            rec.node.setScale(pp.s, pp.s, pp.s);
            rec.node.setRotationFromEuler(0, p.heading * DEG, sway * 60);
            rec.node.active = pp.z > BEHIND_HIDE_Z;
        }
    }

    private placeKuafu(core: GameCore) {
        const p = core.path.sample(core.dist, core.playerLaneF * LANE_W3);
        const r = this.world.toRender(p);
        this.playerX = r.x;
        this.kuafu.root.setPosition(r.x, r.y, r.z);
        this.kuafu.setVisible(!(core.invincible > 0 && Math.floor(core.gTime * 10) % 2 === 0));
        const animState: CharAnimState =
            core.state === 'dying' || core.state === 'dead' ? 'dead'
                : core.state === 'title' ? 'idle'
                    : core.stumbling ? 'stumble'
                        : core.slideT >= 0 ? 'slide'
                            : core.jumpT >= 0 ? 'jump'
                                : 'run';
        this.kuafu.update(this.dt, {
            state: animState,
            runPhase: core.runPhase,
            hop: this.kuafu.lastHop,
            jumpT: core.jumpT,
            slideT: core.slideT,
            stumbleT: core.stumbleTimer,
            gTime: core.gTime,
            yawDeg: p.heading * DEG,
        });
        this.kuafu.shadow.setPosition(r.x, r.y + 0.02, r.z);
    }

    // ---------- 尘土 ----------
    private dust() {
        for (let i = 0; i < 6; i++) {
            const node = this.puffPool.pop() ?? this.node3d(this.root3d, 'puff', this.mSphere, [138, 106, 72]);
            const rr = 0.06 + Math.random() * 0.08;
            node.setScale(rr, rr, rr);
            node.active = true;
            this.puffs.push({
                node,
                x: this.playerX + (Math.random() - 0.5) * 0.5, y: 0.1, z: 0.2 + Math.random() * 0.3,
                vx: (Math.random() - 0.5) * 0.8, vy: 0.6 + Math.random() * 0.9,
                life: 0, max: 0.5 + Math.random() * 0.3,
            });
        }
    }
    private burst() {
        for (let i = 0; i < 14; i++) {
            const node = this.puffPool.pop() ?? this.node3d(this.root3d, 'puff', this.mSphere, [138, 106, 72]);
            const rr = 0.08 + Math.random() * 0.12;
            node.setScale(rr, rr, rr);
            node.active = true;
            this.puffs.push({
                node,
                x: this.playerX + (Math.random() - 0.5) * 0.8, y: 0.2 + Math.random() * 0.4, z: 0.1 + Math.random() * 0.5,
                vx: (Math.random() - 0.5) * 2.4, vy: 1.2 + Math.random() * 1.6,
                life: 0, max: 0.7,
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
        const p = core.path.sample(core.dist, 0);
        const rp = this.world.toRender(p);
        // 天空锚点跟随玩家位置与航向（色带/星空/太阳始终"在远方"）
        this.skyAnchor.setPosition(rp.x, rp.y, rp.z);
        this.skyAnchor.setRotationFromEuler(0, p.heading * DEG, 0);
        this.ground.setPosition(rp.x, -0.15, rp.z);

        const prog = core.skyP;
        const mix = (a: number[], b: number[], t: number) => [
            a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const seg = (t: number): number[] => {
            if (t < 0.45) return mix([25, 18, 51], mix([90, 32, 40], [70, 40, 80], prog), t / 0.45);
            if (t < 0.8) return mix(mix([90, 32, 40], [70, 40, 80], prog), mix([196, 78, 36], [160, 60, 44], prog), (t - 0.45) / 0.35);
            return mix(mix([196, 78, 36], [160, 60, 44], prog), mix([255, 154, 60], [255, 130, 60], prog), (t - 0.8) / 0.2);
        };
        for (const b of this.skyBands) {
            const c = seg(b.t);
            b.node.getComponent(MeshRenderer)!.material!.setProperty('mainColor', new Color(c[0], c[1], c[2], 255));
        }
        const twinkle = (phase: number) => 0.55 + 0.45 * Math.sin(core.gTime * 2 + phase);
        for (const s of this.stars) {
            const k = s.base * (0.6 + 0.6 * twinkle(s.phase)) * (1 - prog * 0.8);
            s.node.setScale(k, k, k);
        }
        const sp = core.sunProgress;                 // 逐日进度：太阳西沉增大——"追上"的视觉反馈
        const sunScale = 12 + prog * 10;
        this.sunNodes[0].setPosition(0, 10 - 5.5 * sp, -160 + 6 * sp);
        this.sunNodes[0].setScale(sunScale * (1 + 0.7 * sp), sunScale * (1 + 0.7 * sp), sunScale * (1 + 0.7 * sp));
        this.sunNodes[1].setScale(sunScale * 1.3 * (1 + 0.7 * sp), sunScale * 1.3 * (1 + 0.7 * sp), sunScale * 1.3 * (1 + 0.7 * sp));
        this.sunNodes[1].setPosition(0, 10 - 5.5 * sp, -160.5 + 6 * sp);
        this.cam.clearColor = new Color(
            Math.round(seg(1)[0]), Math.round(seg(1)[1]), Math.round(seg(1)[2]), 255);
    }

    /** 车道虚线：固定在路径网格上的真实路面标记（随转弯弯曲），玩家身后裁剪 */
    private updateDashes(core: GameCore) {
        const base = Math.floor(core.dist / DASH_STEP) * DASH_STEP;
        for (let i = 0; i < DASH_COUNT; i++) {
            const k = Math.floor(i / 2);
            const d = base + 2 + k * DASH_STEP;
            const p = core.path.sample(d, i % 2 === 0 ? -0.85 : 0.85);
            const r = this.world.toRender(p);
            const dn = this.dashes[i];
            dn.setPosition(r.x, r.y + 0.05, r.z);
            dn.setRotationFromEuler(0, p.heading * DEG, 0);
            dn.active = d - core.dist < 26;
        }
    }

    /** 相机：路径后方跟随（转弯自然摇移）、dt 插值、跳跃高度跟随、速度 fov、震屏上限 */
    private updateCamera(core: GameCore) {
        const cc = this.cfg.camera;
        const camD = Math.max(0, core.dist - CAM_BACK_D);
        const camP = core.path.sample(camD, core.playerLaneF * LANE_W3 * 0.45);
        const hop = this.kuafu.lastHop;
        const targetY = camP.y + CAM_Y + hop * cc.heightFollow;
        const cur = this.camNode.position;
        const k = Math.min(1, this.dt * cc.followLerp);
        const rc = this.world.toRender(camP);
        const nx = cur.x + (rc.x - cur.x) * k;
        const ny = cur.y + (targetY - cur.y) * k;
        const nz = cur.z + (rc.z - cur.z) * k;
        const shake = this.fx.shake > 0.3 ? Math.min(this.fx.shake * 0.012, 0.25) : 0;
        this.camNode.setPosition(
            nx + (Math.random() - 0.5) * shake,
            ny + (Math.random() - 0.5) * shake,
            nz + (Math.random() - 0.5) * shake,
        );
        const spN = Math.max(0, Math.min(1, (core.speed - this.cfg.speed.base) / Math.max(this.cfg.speed.gainCap, 0.001)));
        const targetFov = cc.fovBase + cc.fovGain * spN;
        this.cam.fov += (targetFov - this.cam.fov) * Math.min(1, this.dt * 3);
        const lookP = core.path.sample(core.dist + 3, core.playerLaneF * LANE_W3 * 0.6);
        const rl = this.world.toRender(lookP);
        this.camNode.lookAt(new Vec3(rl.x, rl.y + LOOK_Y, rl.z));
    }
}
