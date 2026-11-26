/**
 * 输入层：触摸（滑动/点按）与键盘 → 归一化意图。
 * 不含玩法判定，不直接操作核心；坐标以逻辑空间(450x800)上报。
 *
 * Phase 1 加固：
 * - 多点触控：按 touch ID 跟踪，仅首个按下且未结束的触点驱动手势，
 *   其余触点（第二根手指）不影响、不覆盖手势状态。
 * - 输入取消：TOUCH_CANCEL 丢弃该触点手势（系统打断/来电等）。
 * - 手势阈值配置化（input.swipeMin / input.tapMax），误触（小于阈值）不触发动作。
 */
import { input, Input, EventTouch, KeyCode, view } from 'cc';
import { Intent } from '../core/types';
import { uiToLogical } from '../render/layout';
import { InputCfg } from '../config/GameConfigSchema';

export interface InputDelegate {
    /** 滑动/方向意图（仅奔跑中会被核心接受） */
    onGesture(intent: Intent): void;
    /** 点按（位移 < tapMax 逻辑像素），逻辑坐标 */
    onTap(gx: number, gy: number): void;
    /** 按下即触发（无需等待抬手），如静音按钮；逻辑坐标 */
    onTapStart(gx: number, gy: number): void;
    /** 键盘 Enter（标题开始） */
    onActionStart(): void;
    /** 键盘 ESC / P（暂停↔恢复切换，PC 调试用） */
    onActionPause(): void;
}

interface TrackedTouch { x: number; y: number; }

export class InputController {
    private delegate: InputDelegate;
    private cfg: InputCfg;
    /** 正在跟踪的触点（多点触控按 ID 隔离） */
    private touches = new Map<number, TrackedTouch>();
    /** 手势归属触点 ID（null = 当前无手势） */
    private gestureId: number | null = null;

    constructor(delegate: InputDelegate, cfg: InputCfg) {
        this.delegate = delegate;
        this.cfg = cfg;
    }

    attach() {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    detach() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    private onTouchStart(e: EventTouch) {
        const id = e.getID() ?? 0;
        const u = e.getUILocation();
        const v = view.getVisibleSize();
        const { gx, gy } = uiToLogical(u.x, u.y, v.width, v.height);
        this.delegate.onTapStart(gx, gy);
        this.touches.set(id, { x: gx, y: gy });
        // 首个未结束触点获得手势归属（第二根手指不抢占）
        if (this.gestureId === null) this.gestureId = id;
    }

    private onTouchEnd(e: EventTouch) {
        this.finishTouch(e, false);
    }

    private onTouchCancel(e: EventTouch) {
        this.finishTouch(e, true);
    }

    private finishTouch(e: EventTouch, cancelled: boolean) {
        const id = e.getID() ?? 0;
        const start = this.touches.get(id);
        this.touches.delete(id);
        if (start === undefined) return;
        // 非手势归属触点（如第二根手指抬起）不产生任何动作
        if (this.gestureId !== id) return;
        this.gestureId = null;
        // 取消：丢弃手势，不触发任何动作
        if (cancelled) return;

        const u = e.getUILocation();
        const v = view.getVisibleSize();
        const { gx, gy } = uiToLogical(u.x, u.y, v.width, v.height);
        const dx = gx - start.x, dy = gy - start.y;
        const MIN = this.cfg.swipeMin, TAP = this.cfg.tapMax;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > MIN) {
            this.delegate.onGesture(dx > 0 ? Intent.LaneRight : Intent.LaneLeft);
        } else if (dy < -MIN) {
            this.delegate.onGesture(Intent.Jump);
        } else if (dy > MIN) {
            this.delegate.onGesture(Intent.Slide);
        } else if (Math.abs(dx) < TAP && Math.abs(dy) < TAP) {
            this.delegate.onTap(gx, gy);
        }
        // 位移介于 TAP 与 MIN 之间的死区：判定为误触，静默丢弃
    }

    private onKey(e: { keyCode: number }) {
        const kc = e.keyCode;
        if (kc === KeyCode.ARROW_LEFT || kc === KeyCode.KEY_A) this.delegate.onGesture(Intent.LaneLeft);
        else if (kc === KeyCode.ARROW_RIGHT || kc === KeyCode.KEY_D) this.delegate.onGesture(Intent.LaneRight);
        else if (kc === KeyCode.ARROW_UP || kc === KeyCode.KEY_W || kc === KeyCode.SPACE) this.delegate.onGesture(Intent.Jump);
        else if (kc === KeyCode.ARROW_DOWN || kc === KeyCode.KEY_S) this.delegate.onGesture(Intent.Slide);
        else if (kc === KeyCode.ENTER) this.delegate.onActionStart();
        else if (kc === KeyCode.ESCAPE || kc === KeyCode.KEY_P) this.delegate.onActionPause();
    }
}
