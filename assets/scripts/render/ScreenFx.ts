/**
 * 屏幕特效状态：震屏 / 红闪 / 慢动作强度。
 * 从核心事件取触发，按 P0 原型的衰减曲线演化；双渲染器共用。
 */
import { CoreEvent, GameState } from '../core/types';

/** P0 特效常量 */
const SHAKE_CRASH = 16;
const SHAKE_SMASH = 6;
const SHAKE_PASS = 2.5;
const RED_FLASH_CRASH = 0.5;
const RED_FLASH_DECAY = 0.8;
const SHAKE_DECAY_DYING = 0.05;
const SHAKE_DECAY_AMBIENT = 0.02;

export class ScreenFx {
    shake = 0;
    redFlash = 0;

    onEvents(events: CoreEvent[]) {
        for (const e of events) {
            if (e.type === 'crash') { this.shake = SHAKE_CRASH; this.redFlash = RED_FLASH_CRASH; }
            else if (e.type === 'obstacleSmashed') this.shake = Math.max(this.shake, SHAKE_SMASH);
            else if (e.type === 'obstaclePassed') this.shake = Math.max(this.shake, SHAKE_PASS);
        }
    }

    /** @param timeScale 慢动作系数：dying 期按缩放时间衰减（与 P0 一致），其余用原始时间 */
    update(dt: number, state: GameState, timeScale: number) {
        const d = state === 'dying' ? dt * timeScale : dt;
        this.shake *= Math.pow(state === 'dying' ? SHAKE_DECAY_DYING : SHAKE_DECAY_AMBIENT, d);
        if (this.redFlash > 0) this.redFlash = Math.max(0, this.redFlash - d * RED_FLASH_DECAY);
    }

    /** 慢动作黑边强度 [0,1]（P0 公式：(1-timeScale)/0.7） */
    slowAmt(timeScale: number): number {
        return Math.max(0, Math.min(1, (1 - timeScale) / 0.7));
    }
}
