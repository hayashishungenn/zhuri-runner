/**
 * CollisionSystem —— 纯数学连续运动与扫描碰撞判定（Phase 8.2.3）。零 cc 依赖。
 *
 * 与 GameCore 及 Reachability 共享同一组几何常量与净空规则：
 * - 基于 [currZ, prevZ] 连续扫描区间，消除高速/冲刺穿透
 * - 按穿越时刻 t ∈ [0, 1] 插值玩家横向车道、跳跃高度与滑铲状态
 * - 滚石等连续横移障碍直接以 visLane 判定
 */

export const COLLISION_GEOM = {
    /** 玩家横向半宽（车道单位，相邻车道中心间距 = 1.0） */
    PLAYER_HALF_WIDTH: 0.22,
    /** 障碍横向半宽 */
    OBS_HALF_WIDTH: 0.30,
    /** 拾取横向半宽 */
    PICKUP_HALF_WIDTH: 0.55,
    /** 站立身高 */
    PLAYER_STAND_HEIGHT: 1.8,
    /** 滑铲身高 */
    PLAYER_SLIDE_HEIGHT: 0.75,
    /** 常规跳跃峰值高度 */
    JUMP_HEIGHT_BASE: 2.0,
    /** 巨人之跃峰值高度 */
    JUMP_HEIGHT_LEAP: 2.5,
    /** 障碍碰撞箱后端 Z */
    OBS_HIT_Z_BACK: -0.35,
    /** 跳跃安全净空高度（与 jumpSafeFrom=0.12 / jumpSafeTo=0.88 对齐） */
    JUMP_CLEAR_HEIGHT: 0.73,
} as const;

/** 计算指定跳跃进度 jt 的离地高度 */
export function jumpHeightAt(jt: number, leapActive: boolean): number {
    if (jt < 0 || jt >= 1) return 0;
    const peak = leapActive ? COLLISION_GEOM.JUMP_HEIGHT_LEAP : COLLISION_GEOM.JUMP_HEIGHT_BASE;
    return Math.sin(jt * Math.PI) * peak;
}

export interface ObstacleSweepInput {
    prevZ: number;
    currZ: number;
    hitZFront: number;
    prevLaneF: number;
    currLaneF: number;
    prevJumpT: number;
    currJumpT: number;
    prevSlideT: number;
    currSlideT: number;
    jumpSafeFrom: number;
    jumpSafeTo: number;
    leapActive: boolean;
    effPass: 'jump' | 'slide' | 'lane';
    lanes: number[];
    /** 滚石等连续横移障碍的浮点车道（undefined 表示按离散 lanes 判定） */
    continuousLane?: number;
}

export interface ObstacleSweepResult {
    /** 是否在当前步与障碍碰撞区间相交 */
    crossed: boolean;
    /** 横向是否与障碍重叠 */
    lateralHit: boolean;
    /** 是否安全通过（横向未命中，或满足跳/滑铲净空） */
    safe: boolean;
}

/** 障碍连续扫描碰撞判定 */
export function evaluateObstacleSweep(p: ObstacleSweepInput): ObstacleSweepResult {
    const hitZBack = COLLISION_GEOM.OBS_HIT_Z_BACK;
    if (!(p.currZ <= p.hitZFront && p.prevZ >= hitZBack)) {
        return { crossed: false, lateralHit: false, safe: true };
    }
    const dz = p.prevZ - p.currZ;
    const t = dz > 1e-6 ? Math.max(0, Math.min(1, (p.prevZ - p.hitZFront) / dz)) : 1;
    const laneAtT = p.prevLaneF + (p.currLaneF - p.prevLaneF) * t;
    const jumpAtT = (p.prevJumpT >= 0 && p.currJumpT >= 0)
        ? p.prevJumpT + (p.currJumpT - p.prevJumpT) * t
        : (p.currJumpT >= 0 ? p.currJumpT : p.prevJumpT);
    const slideAtT = p.prevSlideT >= 0 || p.currSlideT >= 0;

    const lateralThreshold = COLLISION_GEOM.PLAYER_HALF_WIDTH + COLLISION_GEOM.OBS_HALF_WIDTH;
    const lateralHit = p.continuousLane !== undefined
        ? Math.abs(laneAtT - p.continuousLane) < lateralThreshold
        : p.lanes.some((l) => Math.abs(laneAtT - l) < lateralThreshold);

    const jumping = jumpAtT >= 0
        && jumpAtT > p.jumpSafeFrom
        && jumpAtT < p.jumpSafeTo
        && jumpHeightAt(jumpAtT, p.leapActive) >= COLLISION_GEOM.JUMP_CLEAR_HEIGHT;

    let safe = !lateralHit;
    if (lateralHit) {
        if (p.effPass === 'jump') safe = jumping;
        else if (p.effPass === 'slide') safe = slideAtT;
    }
    return { crossed: true, lateralHit, safe };
}

export interface PickupSweepInput {
    prevZ: number;
    currZ: number;
    pickFrom: number;
    pickTo: number;
    prevLaneF: number;
    currLaneF: number;
    targetLane: number;
}

/** 道具/阳炎连续扫描拾取判定（防高速穿透） */
export function evaluatePickupSweep(p: PickupSweepInput): boolean {
    if (!(p.currZ <= p.pickTo && p.prevZ >= p.pickFrom)) return false;
    const dz = p.prevZ - p.currZ;
    const midZ = (p.pickFrom + p.pickTo) * 0.5;
    const t = dz > 1e-6 ? Math.max(0, Math.min(1, (p.prevZ - midZ) / dz)) : 1;
    const laneAtT = p.prevLaneF + (p.currLaneF - p.prevLaneF) * t;
    return Math.abs(laneAtT - p.targetLane) <= COLLISION_GEOM.PICKUP_HALF_WIDTH;
}
