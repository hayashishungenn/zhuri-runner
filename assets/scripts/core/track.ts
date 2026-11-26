/**
 * TrackPath —— 无限跑道世界空间路径（纯数学，零 cc 依赖）。Phase 2。
 *
 * 架构约定：核心玩法层（GameCore）始终工作在**相对坐标**——实体 z 为相对玩家的路径距离，
 * lane 为横向车道偏移；碰撞/生成/拾取逻辑与跑道形状完全无关。
 * 世界空间（含 90° 转弯、坡度、桥洞悬崖）由 SegmentPath 的分段采样承担：
 *   sample(d, laneOffset) → 世界坐标 + 航向角。
 *
 * 坐标约定：
 *   - d：沿路径的绝对距离（逻辑单位，玩家 dist 即其在路径上的位置）。
 *   - heading：航向角（弧度，绕 Y）。0 = 朝 -Z；+π/2 = 左转后朝 -X。
 *     forward(θ) = (-sinθ, -cosθ)，right(θ) = (cosθ, -sinθ)。
 *   - laneOffset：世界单位横向偏移（沿 right 向量）。
 *
 * 浮点精度：sample 返回 float64 绝对坐标；float32 渲染坐标由渲染层 WorldShift 重定位处理（见 render 层）。
 */

export interface PathSample {
    x: number;
    y: number;
    z: number;
    /** 航向角（弧度） */
    heading: number;
}

export type SegmentKind =
    | 'straight' | 'slopeUp' | 'slopeDown'
    | 'arcL' | 'arcR'
    | 'bridge' | 'cliff' | 'cave' | 'transition';

/** 任务书地块数据结构：入口/出口/方向/长度/跑道位置/生成点/地形边界 */
export interface TrackSegment {
    kind: SegmentKind;
    /** 绝对路径起点距离 */
    startD: number;
    length: number;
    entry: { x: number; y: number; z: number };
    entryHeading: number;
    exit: { x: number; y: number; z: number };
    exitHeading: number;
    /** 半宽（世界单位） */
    halfWidth: number;
    /** 坡度（dy/ds，直线类专用） */
    grade: number;
    /** 转弯半径（逻辑单位，弧线段专用）；turn = ±1（左/右） */
    radius: number;
    turn: 0 | -1 | 1;
    /** 主题索引（视觉分段切换） */
    theme: number;
    /** 障碍生成点：false = 该地块内不生成障碍（弯道/特殊地块） */
    allowsObstacles: boolean;
    /** 道具（侧景装饰）生成点 */
    allowsProps: boolean;
    /** 地形边界 */
    boundaryLeft: 'open' | 'rail' | 'wall';
    boundaryRight: 'open' | 'rail' | 'wall';
    /** 地块模板 id（Phase 5，渲染装饰用；生成器可空） */
    templateId?: string;
}

const EPS = 1e-6;

/** 弧长 = θ * R（90° 弧） */
export function arcLength(radius: number): number { return Math.PI / 2 * radius; }

export class SegmentPath {
    segments: TrackSegment[] = [];
    private totalD = 0;
    private cacheIdx = 0;

    get totalLength(): number { return this.totalD; }
    get endD(): number { return this.totalD; }

    /** 追加地块；开发期断言出入口连续（缝隙/重叠/断层在此拦截） */
    append(seg: TrackSegment): void {
        if (this.segments.length) {
            const last = this.segments[this.segments.length - 1];
            const dx = seg.entry.x - last.exit.x, dy = seg.entry.y - last.exit.y, dz = seg.entry.z - last.exit.z;
            const dh = normAngleDelta(seg.entryHeading - last.exitHeading);
            if (Math.abs(dx) > EPS || Math.abs(dy) > EPS || Math.abs(dz) > EPS || Math.abs(dh) > EPS) {
                throw new Error(`地块连接不连续: d=(${dx.toFixed(4)},${dy.toFixed(4)},${dz.toFixed(4)}) dh=${dh}`);
            }
            if (seg.startD !== last.startD + last.length) {
                throw new Error(`地块距离不连续: ${seg.startD} != ${last.startD + last.length}`);
            }
        } else if (seg.startD !== 0) {
            throw new Error('首地块 startD 必须为 0');
        }
        this.totalD = seg.startD + seg.length;
        this.segments.push(seg);
    }

    /** 回收玩家身后地块（保持至少 1 个） */
    trim(beforeD: number): void {
        let drop = 0;
        while (drop < this.segments.length - 1 && this.segments[drop].startD + this.segments[drop].length < beforeD) drop++;
        if (drop > 0) {
            this.segments.splice(0, drop);
            this.cacheIdx = Math.max(0, this.cacheIdx - drop);
        }
    }

    /** 清空（重新开局） */
    clear(): void {
        this.segments.length = 0;
        this.totalD = 0;
        this.cacheIdx = 0;
    }

    /** 定位 d 所在地块（cacheIdx 单调前向加速；trim 后自动重扫） */
    segmentAt(d: number): TrackSegment {
        const segs = this.segments;
        if (!segs.length) throw new Error('路径为空');
        let i = Math.min(this.cacheIdx, segs.length - 1);
        if (d < segs[i].startD) i = 0;                       // 回退（trim 后重扫）
        while (i < segs.length - 1 && d >= segs[i].startD + segs[i].length) i++;
        while (i > 0 && d < segs[i].startD) i--;
        this.cacheIdx = i;
        return segs[i];
    }

    /** 采样：世界坐标 + 航向；laneOffset 沿 right 向量（世界单位） */
    sample(d: number, laneOffset = 0): PathSample {
        const seg = this.segmentAt(d);
        const s = Math.max(0, Math.min(d - seg.startD, seg.length));
        let x: number, y: number, z: number, heading: number;
        if (seg.turn !== 0) {
            // 弧线：绕圆心。C = entry − turn·right0·R（左转圆心在左侧）；pos = C + turn·right(θ)·R。
            // 求导 d(pos)/dφ = R·forward(θ) > 0，保证弧线沿行进方向展开。
            const R = seg.radius;
            const phi = s / R;
            heading = seg.entryHeading + seg.turn * phi;
            const r0x = Math.cos(seg.entryHeading), r0z = -Math.sin(seg.entryHeading);
            const cx = seg.entry.x - r0x * R * seg.turn;
            const cz = seg.entry.z - r0z * R * seg.turn;
            const rx = Math.cos(heading), rz = -Math.sin(heading);
            x = cx + rx * R * seg.turn;
            z = cz + rz * R * seg.turn;
            y = seg.entry.y;
        } else {
            const fx = -Math.sin(seg.entryHeading), fz = -Math.cos(seg.entryHeading);
            x = seg.entry.x + fx * s;
            z = seg.entry.z + fz * s;
            heading = seg.entryHeading;
            y = seg.entry.y + seg.grade * s;
            if (seg.kind === 'bridge') {
                // 桥面拱起（正弦峰，峰值 1.2）
                y += Math.sin(Math.PI * s / Math.max(seg.length, EPS)) * 1.2;
            }
        }
        // 横向偏移（沿航向 right 向量）
        if (laneOffset !== 0) {
            x += Math.cos(heading) * laneOffset;
            z += -Math.sin(heading) * laneOffset;
        }
        return { x, y, z, heading };
    }

    /**
     * 障碍/碎片安全生成区：d 及前后 margin 覆盖的全部地块均允许生成（弯道/特殊地块自动排除）。
     */
    isSafeSpawnZone(d: number, margin: number): boolean {
        return this.isSafeSpawnRange(d, d, margin, 'obstacles');
    }

    /**
     * 区间安全生成检查：[min(startD,endD)-margin, max(startD,endD)+margin] 覆盖的全部地块
     * 必须满足对应生成许可（obstacles / props），避免跨段漏检短弯道或过渡地块。
     */
    isSafeSpawnRange(startD: number, endD: number, margin: number, kind: 'obstacles' | 'props' = 'obstacles'): boolean {
        const segs = this.segments;
        if (!segs.length) return false;
        const lo = Math.min(startD, endD) - margin;
        const hi = Math.max(startD, endD) + margin;
        if (hi > this.totalD) return false;
        // 定位首个与 [lo, hi] 相交的地块
        const firstSeg = this.segmentAt(lo);
        let idx = this.cacheIdx;
        if (segs[idx] !== firstSeg) idx = segs.indexOf(firstSeg);
        for (let i = Math.max(0, idx); i < segs.length; i++) {
            const seg = segs[i];
            if (seg.startD > hi) break;
            const segEnd = seg.startD + seg.length;
            if (segEnd >= lo) {
                const ok = kind === 'obstacles' ? seg.allowsObstacles : seg.allowsProps;
                if (!ok) return false;
            }
        }
        return true;
    }
}

/** 角度差归一化到 [-π, π] */
export function normAngleDelta(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

/** 航向角归一化到 [0, 2π) */
export function normHeading(h: number): number {
    const TAU = Math.PI * 2;
    const r = h % TAU;
    return r < 0 ? r + TAU : r;
}
