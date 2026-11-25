/** 核心层类型 —— 纯数据，零 cc 依赖 */

export type ObstacleType = 'rock' | 'log' | 'wall';
export type GameState = 'title' | 'run' | 'dying' | 'dead';

export interface Obstacle {
    lane: number;          // -1 | 0 | 1
    type: ObstacleType;
    z: number;
    passed: boolean;       // 已经过判定点
}

export interface Fragment {
    lane: number;
    z: number;
    got: boolean;
}

export interface Prop {
    x: number;             // 车道单位（可越出 ±1）
    z: number;
    kind: 'tree' | 'rock';
    s: number;             // 尺寸系数
    sway: number;          // 摆动相位
}

export type CoreEventType = 'fragment' | 'milestone' | 'crash' | 'died'
    | 'obstacleSmashed' | 'obstaclePassed'
    | 'jump' | 'land' | 'slideStart' | 'stumble'
    | 'turnOk' | 'turnMiss';

export interface CoreEvent {
    type: CoreEventType;
    /** milestone 事件：到达的里程碑数值 */
    n?: number;
    /** fragment 事件：车道 */
    lane?: number;
}

/** 输入意图（由输入层产生，核心层消费） */
export enum Intent { LaneLeft, LaneRight, Jump, Slide }
