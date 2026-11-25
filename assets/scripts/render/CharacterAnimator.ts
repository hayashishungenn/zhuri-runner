/**
 * CharacterAnimator —— 角色动画状态接口（任务书 Phase 1 动画系统）。
 *
 * 状态集：idle / run / jump / slide / stumble / dead。
 * 接口与表现解耦：ProceduralKuafu 为几何体程序化实现（原创、零授权风险）；
 * P2 替换为原创夸父绑定模型时，实现同一接口（SkinnedKuafuAnimator）即可整体换装，
 * 渲染器与核心层零改动。
 *
 * 输入 AnimInput 由渲染器从核心状态推导（本层不读核心，保持可替换）。
 */

export type CharAnimState = 'idle' | 'run' | 'jump' | 'slide' | 'stumble' | 'dead';

export interface AnimInput {
    state: CharAnimState;
    /** 跑动相位（run 用） */
    runPhase: number;
    /** 跳跃离地高度（世界单位，jump 用） */
    hop: number;
    /** 跳跃进度 [0,1)；-1 表示不在空中 */
    jumpT: number;
    /** 滑铲剩余秒（>0 即滑铲中） */
    slideT: number;
    /** 踉跄剩余秒（>0 即踉跄中） */
    stumbleT: number;
    /** 全局时钟（用于踉跄晃动/待机呼吸等相位） */
    gTime: number;
    /** 航向角（度，Phase 2 转弯后角色世界朝向） */
    yawDeg: number;
}

export interface CharacterAnimator {
    /** 每帧驱动；实现内部自行做状态切换/混合 */
    update(dt: number, input: AnimInput): void;
    /** 角色根节点（渲染器负责世界定位与缩放） */
    readonly root: import('cc').Node;
    /** 影子节点（随跳跃缩放；渲染器负责地面定位） */
    readonly shadow: import('cc').Node;
    /** 最近一帧的跳跃离地高度（供相机/影子使用） */
    readonly lastHop: number;
    destroy(): void;
}
