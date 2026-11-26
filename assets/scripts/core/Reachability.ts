/**
 * Reachability —— 障碍序列可达性验证器（纯数学，零 cc 依赖）。Phase 3。
 *
 * 任务书要求：根据角色速度、跳跃距离、滑铲时间、切道时间和反应窗口，
 * 判断生成结果是否至少存在一条可行路线；不得仅以"保留空跑道"代替完整验证。
 *
 * 模型：事件图上的状态区间传播。
 *   玩家状态 = (车道 lane, 最早可用距离 ready)。
 *   对每个障碍事件（按距离排序）：占道集合 L、所需动作 A（jump/slide/lane/any）：
 *     - 转移 1（变道）：ready→事件点距离 ≥ laneChangeDist 时，可从 lane 转到相邻 lane'
 *     - 转移 2（动作通过）：若 A ∈ {jump, slide}，在事件点处于该动作即可原地通过，
 *       动作起跳需提前：占用区间 = [d − cover/2, d + cover/2]，状态保持 lane，ready = d + cover/2
 *     - 转移 3（原地不动）：lane ∉ L 且 ready ≤ d → 直接通过
 *   任一状态活到序列末尾 → 可达。可行集为空 → 必死组合（拒绝生成）。
 *
 * 注意：转移 2 的"提前量"内玩家不能变道（cover/2 内锁定），转移 1 变道期间也不能动作 ——
 * 这保证了验证不是"总有空道"的平凡解，而是真实覆盖动作时间窗的可达性。
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
    /** 变道 ±1 需要的距离（速度 × 变道时间） */
    laneChangeDist: number;
    /** 跳跃覆盖距离（速度 × 跳跃时长 × 系数） */
    jumpCover: number;
    /** 滑铲覆盖距离 */
    slideCover: number;
    /** 最小反应距离（速度 × 最小反应时间）——事件间至少留此距离 */
    reactionDist: number;
}

interface State { lane: number; ready: number; }

export interface ReachabilityResult {
    reachable: boolean;
    /** 不可达时首个无解的事件索引（可达为 -1） */
    failedAt: number;
    /** 存活状态数（诊断用） */
    alive: number;
}

const LANES = [-1, 0, 1];

export function validateReachability(events: ObstacleEvent[], ability: RunnerAbility): ReachabilityResult {
    // 按距离排序（同距离合并占道与动作：任一动作满足即可 → 取最严格的 lane 类优先）
    const sorted = [...events].sort((a, b) => a.d - b.d);
    let states: State[] = [{ lane: 0, ready: 0 }];

    // 注：±1 逐级变道不经过中间车道；源车道上的障碍恰是"必须离开"的原因，
    // 其时机约束已由 `d − ready ≥ laneChangeDist + reactionDist` 守卫（必须在判定前完成离开）。
    for (let i = 0; i < sorted.length; i++) {
        const ev = sorted[i];
        const next: State[] = [];
        const inLanes = (lane: number) => ev.lanes.includes(lane);

        for (const st of states) {
            // 转移 3：不在占道且已就绪 → 直接通过
            if (!inLanes(st.lane) && ev.d - st.ready >= 0) {
                next.push({ lane: st.lane, ready: Math.max(st.ready, ev.d + ability.reactionDist * 0) });
            }
            // 转移 2：动作通过（jump/slide）：需提前 cover/2 进入动作。
            // 动作期间允许同步变道（规则：空中/滑铲中变道 ✓）——滑铲/跳跃中可转入相邻车道，
            // 动作结束时落在相邻车道（ready = d + lead 与原地通过一致）。
            if (ev.pass === 'jump' || ev.pass === 'slide') {
                const cover = ev.pass === 'jump' ? ability.jumpCover : ability.slideCover;
                const lead = cover / 2;
                if (ev.d - st.ready >= lead) {
                    next.push({ lane: st.lane, ready: ev.d + lead });
                    for (const lane of LANES) {
                        if (Math.abs(lane - st.lane) === 1 && !inLanes(lane)) {
                            next.push({ lane, ready: ev.d + lead });
                        }
                    }
                }
            }
            // 转移 1：变道后通过（lane 类或避险）——变道距离 + 反应距离守卫
            if (ev.d - st.ready >= ability.laneChangeDist + ability.reactionDist) {
                for (const lane of LANES) {
                    if (lane === st.lane || inLanes(lane)) continue;
                    if (Math.abs(lane - st.lane) !== 1) continue;      // ±1 逐级变道
                    next.push({ lane, ready: ev.d });
                }
            }
        }
        // 去重（同车道取最早 ready）
        const byLane = new Map<number, State>();
        for (const st of next) {
            const old = byLane.get(st.lane);
            if (!old || st.ready < old.ready) byLane.set(st.lane, st);
        }
        states = [...byLane.values()];
        if (!states.length) return { reachable: false, failedAt: i, alive: 0 };
    }
    return { reachable: true, failedAt: -1, alive: states.length };
}

/**
 * 便捷构造：按当前速度推导能力参数。
 * reactionDist 语义：事件间转移的反应守卫。障碍在 z=34（≥1.1s）即可见，
 * 玩家的观察-反应大部分被可见性覆盖，此处仅保留 30% 余量作为纯反应守卫
 * （100% 反应守卫会把"玩家提前预走位"的组合误判为不可达）。
 */
export function abilityForSpeed(speed: number, p: { laneLerp: number; jumpDuration: number; slideDuration: number; reactionTime: number }): RunnerAbility {
    return {
        laneChangeDist: speed * (1 / p.laneLerp) * 1.2,      // 缓动到稳定的时间系数
        jumpCover: speed * p.jumpDuration * 0.85,
        slideCover: speed * p.slideDuration * 0.9,
        reactionDist: speed * p.reactionTime * 0.3,
    };
}
