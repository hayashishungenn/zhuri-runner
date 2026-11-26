/** 核心层类型 —— 纯数据，零 cc 依赖 */

export type GameState = 'title' | 'run' | 'dying' | 'dead' | 'ended';

/** Phase 3 道具种类 */
export type ItemKind = 'magnet' | 'shield' | 'dash' | 'double' | 'water' | 'staff' | 'leap';

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
    | 'shieldBreak' | 'item' | 'water'
    | 'staffBreak' | 'cool' | 'stage' | 'journeyDone';

export interface CoreEvent {
    type: CoreEventType;
    /** milestone 事件：到达的里程碑数值；stage 事件：阶段序号 */
    n?: number;
    /** fragment/item 事件：车道 */
    lane?: number;
    /** item 事件：道具种类 */
    kind?: string;
    /** cool 事件：降温量；fragment 事件：实际获得枚数（1 或 2） */
    amount?: number;
    /** stage 事件：阶段文案 */
    label?: string;
}

/** 单局模式参数覆写（例如教程稀疏生成），不修改共享 GameConfig */
export interface RunModeOverrides {
    spawnRowInterval?: number;
    turnsEnabled?: boolean;
    turnGapMin?: number;
    turnGapMax?: number;
}

/** 开局附加神通（如广告限时神通），在 reset 之后注入核心 */
export interface StartRunBuffs {
    magnetT?: number;
    dashT?: number;
}

/** startRun 可选参数 */
export interface StartRunOptions {
    seed?: number;
    mode?: 'endless' | 'journey';
    overrides?: RunModeOverrides | null;
    startBuffs?: StartRunBuffs | null;
}

/** 输入意图（由输入层产生，核心层消费） */
export enum Intent { LaneLeft, LaneRight, Jump, Slide }
