/**
 * 渲染器接口：核心状态 → 画面。实现只读核心，特效副作用留在本层。
 */
import { GameCore } from '../core/GameCore';
import { AdService } from '../platform/AdService';
import { CoreEvent } from '../core/types';
import { Hud2D } from './Hud2D';

export interface IRenderer {
    /** 每帧渲染。dt 为本帧原始秒差（供本层特效演化） */
    render(core: GameCore, ad: AdService, dt: number, hud: Hud2D): void;
    /** 核心事件分发（撞击/击碎/拾取…） */
    onCoreEvents(events: CoreEvent[]): void;
    /** 释放本渲染器持有的节点（2D 层随场景销毁，实现可为空） */
    destroy(): void;
}
