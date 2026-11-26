/** 核心层类型 —— 纯数据，零 cc 依赖 */

export type GameState = 'title' | 'run' | 'dying' | 'dead';

/** Phase 3 道具种类 */
export type ItemKind = 'magnet' | 'shield' | 'dash' | 'double' | 'water';

export interface Obstacle {
    /** 目录 defId（数据驱动） */
    defId: string;
    lane: number;          // 锚点车道 -1 | 0 | 1（timing 障碍会被核心逐帧更新）
    z: number;
    passed: boolean;       // 已经过判定点
    /** 生成相位（timing 障碍的去同步化，秒） */
    phase: number;
    /** 滚石等连续横移障碍的可视车道（浮点；渲染器用） */
    visLane?: number;
}

/** 道具拾取物 */
export interface ItemEntity {
    kind: ItemKind;
    lane: number;
    z: number;
    got: boolean;
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
    | 'turnOk' | 'turnMiss'
    | 'shieldBreak' | 'item' | 'water';

export interface CoreEvent {
    type: CoreEventType;
    /** milestone 事件：到达的里程碑数值 */
    n?: number;
    /** fragment/item 事件：车道 */
    lane?: number;
    /** item 事件：道具种类 */
    kind?: string;
}

/** 输入意图（由输入层产生，核心层消费） */
export enum Intent { LaneLeft, LaneRight, Jump, Slide }
