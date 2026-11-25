/**
 * TrackPath —— 跑道路径抽象（纯数学，零 cc 依赖）。
 *
 * 任务书 Phase 1 要求"支持角色前进方向动态变化，为后续 90 度转弯和复杂道路预留能力"。
 * 核心逻辑保持 1D 距离推进（dist / z），世界坐标映射由 TrackPath 承担：
 *   - 现阶段：StraightPath（直线跑道）
 *   - 后续（P2+）：ArcPath/CurvePath 实现同一接口即可接入转弯，核心玩法层零改动。
 *
 * 坐标约定：forward 为玩家前方距离（逻辑 z，正数朝远处），lane 为车道偏移（-1/0/1）。
 * sample 返回世界坐标 + 航向角 heading（弧度，0 = 朝 -Z；后续转弯非 0）。
 */

export interface PathSample {
    x: number;
    z: number;
    /** 航向角（弧度）。0 = 朝 -Z 直行；正值表示航向向左偏（用于实体/相机朝向） */
    heading: number;
}

export interface TrackPath {
    sample(forward: number, laneOffset: number): PathSample;
    headingAt(forward: number): number;
}

/** 直线路径：heading 恒 0，x 随车道线性偏移，z 随距离线性推远。 */
export class StraightPath implements TrackPath {
    private laneW: number;
    private zScale: number;

    constructor(laneWorldWidth: number, zScale: number) {
        this.laneW = laneWorldWidth;
        this.zScale = zScale;
    }

    sample(forward: number, laneOffset: number): PathSample {
        return { x: laneOffset * this.laneW, z: -forward * this.zScale, heading: 0 };
    }

    headingAt(_forward: number): number { return 0; }
}
