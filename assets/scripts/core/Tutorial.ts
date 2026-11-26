/**
 * Tutorial —— 可跳过交互式新手引导（Phase 6）。
 * 步骤：切道 → 跳跃 → 滑铲 → 拾取甘霖 → 拾取神通 → 路口转弯；
 * 每步等待玩家真实完成对应动作（事件驱动）；全部完成或跳过即离场。
 */
import { CoreEvent } from './types';
import { GameCore } from './GameCore';

export interface TutorialStep {
    id: string;
    text: string;
    /** 由核心状态/事件标记判定是否完成 */
    check: (c: GameCore, marks: TutorialMarks) => boolean;
}

export interface TutorialMarks {
    waterSeen: boolean;
    itemSeen: boolean;
    turnDone: boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
    { id: 'lane', text: '左右滑动 切换跑道', check: (c) => c.targetLane !== 0 },
    { id: 'jump', text: '上滑 跳跃', check: (c) => c.airborne },
    { id: 'slide', text: '下滑 滑铲', check: (c) => c.slideT >= 0 },
    { id: 'water', text: '拾取甘霖 降温', check: (_c, m) => m.waterSeen },
    { id: 'item', text: '拾取神通 获得增益', check: (_c, m) => m.itemSeen },
    { id: 'turn', text: '路口按提示方向转向', check: (_c, m) => m.turnDone },
];

export class Tutorial {
    private idx = 0;
    done = false;
    skipped = false;
    active: boolean;
    marks: TutorialMarks = { waterSeen: false, itemSeen: false, turnDone: false };

    constructor(active: boolean, startIdx = 0) {
        this.active = active;
        this.idx = startIdx;
        this.done = !active || startIdx >= TUTORIAL_STEPS.length;
        if (startIdx > 2) this.marks.waterSeen = this.marks.itemSeen = true;
        if (startIdx > 5) this.marks.turnDone = true;
    }

    get step(): TutorialStep | null {
        return this.done ? null : TUTORIAL_STEPS[this.idx];
    }

    get progressText(): string {
        return `${Math.min(this.idx + 1, TUTORIAL_STEPS.length)}/${TUTORIAL_STEPS.length}`;
    }

    /** 事件喂数（转弯/拾取标记） */
    onEvents(events: CoreEvent[]): void {
        for (const e of events) {
            if (e.type === 'item') {
                this.marks.itemSeen = true;
                if (e.kind === 'water') this.marks.waterSeen = true;
            }
            if (e.type === 'turnOk') this.marks.turnDone = true;
        }
    }

    /** 每帧推进：当前步骤完成 → 下一步 */
    update(c: GameCore): void {
        if (this.done || !this.active) return;
        const st = this.step!;
        if (st.check(c, this.marks)) {
            this.idx++;
            if (this.idx >= TUTORIAL_STEPS.length) {
                this.done = true;
                this.active = false;
            }
        }
    }

    skip(): void {
        this.skipped = true;
        this.done = true;
        this.active = false;
    }
}
