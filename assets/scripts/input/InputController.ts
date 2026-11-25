/**
 * 输入层：触摸（滑动/点按）与键盘 → 归一化意图。
 * 不含玩法判定，不直接操作核心；坐标以逻辑空间(450x800)上报。
 */
import { input, Input, EventTouch, KeyCode } from 'cc';
import { Intent } from '../core/types';
import { toLogicalX, toLogicalY } from '../render/layout';

export interface InputDelegate {
    /** 滑动/方向意图（仅奔跑中会被核心接受） */
    onGesture(intent: Intent): void;
    /** 点按（位移 < 8 逻辑像素），逻辑坐标 */
    onTap(gx: number, gy: number): void;
    /** 按下即触发（无需等待抬手），如静音按钮；逻辑坐标 */
    onTapStart(gx: number, gy: number): void;
    /** 键盘 Enter（标题开始） */
    onActionStart(): void;
}

export class InputController {
    private delegate: InputDelegate;
    private swipe: { x: number; y: number } | null = null;

    // 与 P0 一致的判定阈值（逻辑像素）
    private static readonly SWIPE_MIN = 18;
    private static readonly TAP_MAX = 8;

    constructor(delegate: InputDelegate) {
        this.delegate = delegate;
    }

    attach() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    detach() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    private onTouchStart(e: EventTouch) {
        const u = e.getUILocation();
        this.delegate.onTapStart(toLogicalX(u.x), toLogicalY(u.y));
        this.swipe = { x: toLogicalX(u.x), y: toLogicalY(u.y) };
    }

    private onTouchEnd(e: EventTouch) {
        if (!this.swipe) return;
        const u = e.getUILocation();
        const gx = toLogicalX(u.x), gy = toLogicalY(u.y);
        const dx = gx - this.swipe.x, dy = gy - this.swipe.y;
        this.swipe = null;
        const MIN = InputController.SWIPE_MIN, TAP = InputController.TAP_MAX;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > MIN) {
            this.delegate.onGesture(dx > 0 ? Intent.LaneRight : Intent.LaneLeft);
        } else if (dy < -MIN) {
            this.delegate.onGesture(Intent.Jump);
        } else if (dy > MIN) {
            this.delegate.onGesture(Intent.Slide);
        } else if (Math.abs(dx) < TAP && Math.abs(dy) < TAP) {
            this.delegate.onTap(gx, gy);
        }
    }

    private onKey(e: { keyCode: number }) {
        const kc = e.keyCode;
        if (kc === KeyCode.ARROW_LEFT || kc === KeyCode.KEY_A) this.delegate.onGesture(Intent.LaneLeft);
        else if (kc === KeyCode.ARROW_RIGHT || kc === KeyCode.KEY_D) this.delegate.onGesture(Intent.LaneRight);
        else if (kc === KeyCode.ARROW_UP || kc === KeyCode.KEY_W || kc === KeyCode.SPACE) this.delegate.onGesture(Intent.Jump);
        else if (kc === KeyCode.ARROW_DOWN || kc === KeyCode.KEY_S) this.delegate.onGesture(Intent.Slide);
        else if (kc === KeyCode.ENTER) this.delegate.onActionStart();
    }
}
