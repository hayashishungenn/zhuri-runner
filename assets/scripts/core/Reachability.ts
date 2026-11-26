/**
 * Reachability —— 障碍序列可达性验证与可执行操作规划器（纯数学，零 cc 依赖）。
 *
 * Phase 8.1 升级：
 * - 同距离多障碍合并为同一 WaveSlot（修复未合并导致 fireCorridor 等合法组合误判的缺陷）
 * - 支持传入初始状态（当前车道/起始就绪距离），不再硬编码 { lane: 0, ready: 0 }
 * - 输出可执行操作序列 plan（含目标距离与动作类型），供真实 GameCore 重放验证
 * - 能力参数与 GameCore 连续运动/跳跃/滑铲窗口对齐
 */

export interface ObstacleEvent {
    /** 绝对距离（排序键） */
    d: number;
    /** 占道集合（如 [-1, 0]） */
    lanes: number[];
    /** 所需通过动作 */
    pass: 'jump' | 'slide' | 'lane';
}

export interface RunnerAbility {
    /** 变道 ±1 需要的距离（速度 × 变道稳定时间） */
    laneChangeDist: number;
    /** 跳跃覆盖距离（速度 × 跳跃时长） */
    jumpCover: number;
    /** 滑铲覆盖距离（速度 × 滑铲时长） */
    slideCover: number;
    /** 最小反应距离（速度 × 最小反应时间） */
    reactionDist: number;
}

export interface ReachabilityInit {
    /** 允许的起始状态（默认 [{ lane: 0, ready: 0 }]） */
    states?: { lane: number; ready: number; actionReady?: number }[];
}

export interface PlanAction {
    /** 触发该动作的绝对距离 */
    d: number;
    /** 动作类型 */
    action: 'lane' | 'jump' | 'slide';
    /** 目标车道（action === 'lane' 时有效） */
    targetLane?: number;
    /** 对应障碍事件距离（诊断用） */
    eventD: number;
}

interface StateNode {
    lane: number;
    /** 变道就绪距离（空中允许变道，不受跳跃落地阻塞） */
    laneReady: number;
    /** 动作就绪距离（下一次起跳/滑铲需等待当前动作结束） */
    actionReady: number;
    plan: PlanAction[];
}

export interface ReachabilityResult {
    reachable: boolean;
    /** 不可达时首个无解的事件槽索引（可达为 -1） */
    failedAt: number;
    /** 存活状态数（诊断用） */
    alive: number;
    /** 可执行操作序列（可达时返回最优存活路径的操作计划） */
    plan: PlanAction[];
    /** 末尾存活状态（可用于跨波延续） */
    endStates: { lane: number; ready: number; actionReady: number }[];
}

const LANES = [-1, 0, 1] as const;
const SAME_D_EPS = 0.05;

type LaneReq = 'none' | 'jump' | 'slide' | 'blocked';

interface WaveSlot {
    d: number;
    req: Record<number, LaneReq>;
}

/** 将同一距离（误差 <= 0.05）的多个障碍合并为单排需求 */
function mergeSlots(events: ObstacleEvent[]): WaveSlot[] {
    if (!events.length) return [];
    const sorted = [...events].sort((a, b) => a.d - b.d);
    const slots: WaveSlot[] = [];

    for (const ev of sorted) {
        let slot = slots.length ? slots[slots.length - 1] : null;
        if (!slot || Math.abs(ev.d - slot.d) > SAME_D_EPS) {
            slot = { d: ev.d, req: { [-1]: 'none', 0: 'none', 1: 'none' } };
            slots.push(slot);
        }
        for (const lane of ev.lanes) {
            if (lane < -1 || lane > 1) continue;
            const cur = slot.req[lane];
            if (ev.pass === 'lane') {
                slot.req[lane] = 'blocked';
            } else if (cur === 'none') {
                slot.req[lane] = ev.pass;
            } else if (cur !== ev.pass) {
                // 同一车道同一位置同时要求跳和滑铲（或已被封死）→ 不可通过
                slot.req[lane] = 'blocked';
            }
        }
    }
    return slots;
}

export function validateReachability(
    events: ObstacleEvent[],
    ability: RunnerAbility,
    init?: ReachabilityInit,
): ReachabilityResult {
    const slots = mergeSlots(events);
    let states: StateNode[] = (init?.states?.length ? init.states : [{ lane: 0, ready: 0 }])
        .map((s) => ({ lane: s.lane, laneReady: s.ready, actionReady: s.actionReady ?? s.ready, plan: [] }));

    if (!slots.length) {
        return {
            reachable: true,
            failedAt: -1,
            alive: states.length,
            plan: [],
            endStates: states.map(({ lane, laneReady, actionReady }) => ({ lane, ready: laneReady, actionReady })),
        };
    }

    // 动作提前量与落地/结束恢复量（与 GameCore 跳跃 [0.12, 0.88] 及滑铲窗口对齐）
    const jumpLead = ability.jumpCover * 0.42;
    const jumpTail = ability.jumpCover * 0.58;
    const slideLead = ability.slideCover * 0.40;
    const slideTail = ability.slideCover * 0.60;

    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const next: StateNode[] = [];

        for (const st of states) {
            for (const targetLane of LANES) {
                const req = slot.req[targetLane];
                if (req === 'blocked') continue;

                const laneDelta = Math.abs(targetLane - st.lane);
                const moveDist = laneDelta === 0
                    ? 0
                    : laneDelta * ability.laneChangeDist + ability.reactionDist;

                if (req === 'none') {
                    // 空车道：若在 slot.d 前可完成变道，或上一个变道已就绪（laneReady <= slot.d）且源/目标（及中间）车道在 slot.d 均无障碍
                    const midClear = laneDelta < 2 || slot.req[(st.lane + targetLane) / 2] === 'none';
                    const transitionSafeAcrossSlot = laneDelta > 0 && st.laneReady <= slot.d && slot.req[st.lane] === 'none' && midClear;
                    if (slot.d - st.laneReady >= moveDist || transitionSafeAcrossSlot) {
                        const actions = laneDelta > 0
                            ? [...st.plan, {
                                d: st.laneReady,
                                action: 'lane' as const,
                                targetLane,
                                eventD: slot.d,
                            }]
                            : st.plan;
                        next.push({
                            lane: targetLane,
                            laneReady: Math.max(st.laneReady + moveDist, slot.d),
                            actionReady: Math.max(st.actionReady, st.laneReady + moveDist),
                            plan: actions,
                        });
                    }
                } else {
                    // jump 或 slide：既需变道到位，也需上一个动作已结束（actionReady）并留足提前量 lead
                    const lead = req === 'jump' ? jumpLead : slideLead;
                    const tail = req === 'jump' ? jumpTail : slideTail;
                    const earliestTrigger = Math.max(st.actionReady, st.laneReady + moveDist);
                    if (slot.d - earliestTrigger >= lead) {
                        const actions = [...st.plan];
                        if (laneDelta > 0) {
                            actions.push({
                                d: st.laneReady,
                                action: 'lane',
                                targetLane,
                                eventD: slot.d,
                            });
                        }
                        actions.push({
                            d: Math.max(earliestTrigger, slot.d - lead),
                            action: req,
                            eventD: slot.d,
                        });
                        next.push({
                            lane: targetLane,
                            laneReady: Math.max(st.laneReady + moveDist, slot.d),
                            actionReady: slot.d + tail,
                            plan: actions,
                        });
                    }
                }
            }
        }

        // 去重（同车道取综合最早就绪，保留对应 plan）
        const byLane = new Map<number, StateNode>();
        for (const st of next) {
            const old = byLane.get(st.lane);
            const score = Math.max(st.laneReady, st.actionReady);
            const oldScore = old ? Math.max(old.laneReady, old.actionReady) : Infinity;
            if (!old || score < oldScore || (score === oldScore && st.plan.length < old.plan.length)) {
                byLane.set(st.lane, st);
            }
        }
        states = [...byLane.values()];
        if (!states.length) {
            return { reachable: false, failedAt: i, alive: 0, plan: [], endStates: [] };
        }
    }

    states.sort((a, b) => Math.max(a.laneReady, a.actionReady) - Math.max(b.laneReady, b.actionReady) || a.plan.length - b.plan.length);
    return {
        reachable: true,
        failedAt: -1,
        alive: states.length,
        plan: states[0].plan,
        endStates: states.map(({ lane, laneReady, actionReady }) => ({ lane, ready: laneReady, actionReady })),
    };
}

/**
 * 便捷构造：按当前速度推导能力参数。
 * laneChangeDist 基于 laneLerp 连续穿越所需时间（含角色宽度与障碍宽度）；
 * jumpCover / slideCover 对应完整动作持续距离；
 * reactionDist 保留 30% 反应余量（障碍提前 46 单位可见）。
 */
export function abilityForSpeed(
    speed: number,
    p: { laneLerp: number; jumpDuration: number; slideDuration: number; reactionTime: number },
): RunnerAbility {
    const safeSpeed = Math.max(1, speed);
    return {
        laneChangeDist: safeSpeed * (1 / p.laneLerp) * 1.8,
        jumpCover: safeSpeed * p.jumpDuration,
        slideCover: safeSpeed * p.slideDuration,
        reactionDist: safeSpeed * p.reactionTime * 0.3,
    };
}
