/**
 * RenderContracts —— 渲染层资产替换契约与资源监控（Phase 8.2.9 / 8.2.10，零 cc 依赖）。
 *
 * 目标：
 * 1. 为后续商业级 3D 美术（FBX/glTF 绑定骨骼模型、SkeletalAnimation 片段、LOD、
 *    皮肤配饰挂点、模块化地块/障碍/道具/主题天空资产）提供明确、可单测的接口契约。
 * 2. 替换角色或场景美术资产时，仅需提供新的 Provider/Binder 实现，无需改动
 *    GameCore、GameSession、CollisionSystem 或 Reachability。
 * 3. 提供轻量开发期资源统计快照（RenderResourceStats）与泄漏追踪器（ResourceTracker）。
 */
import type { CharAnimState, AnimInput } from './CharacterAnimator';
import type { SkinAccessory, SkinDef } from '../config/SkinCatalog';

export type LodLevel = 0 | 1 | 2;
export type AccessorySlot = 'head' | 'back' | 'hand' | 'aura';

/** 皮肤表现描述符（从 SkinDef 投影出的纯渲染数据，不含价格/解锁逻辑） */
export interface CharacterSkinVisual {
    id: string;
    bodyTint: [number, number, number];
    staffTint: [number, number, number];
    accessories: readonly SkinAccessory[];
    /** 未来 FBX/glTF 皮肤预制体或材质资源路径（可选） */
    assetPath?: string;
}

/** 角色骨骼/动画资产契约（泛型 TNode 默认 unknown，保持零 cc 依赖） */
export interface CharacterVisualHandle<TNode = unknown> {
    readonly root: TNode;
    readonly shadow: TNode;
    readonly lastHop: number;
    update(dt: number, input: AnimInput): void;
    applySkin(skin: CharacterSkinVisual): void;
    setVisible(visible: boolean): void;
    setLod?(lod: LodLevel): void;
    /** 未来骨骼动画片段映射（如 'run' -> 'Kuafu_Run_Loop'） */
    readonly clipMap?: Readonly<Partial<Record<CharAnimState, string>>>;
    /** 未来配饰挂点表 */
    readonly sockets?: Readonly<Partial<Record<AccessorySlot, TNode>>>;
    destroy(): void;
}

/** 角色资产工厂：可在程序化模型（ProceduralKuafu）与正式 3D FBX/glTF 模型间零侵入切换 */
export interface CharacterAssetProvider<TNode = unknown> {
    readonly providerId: string;
    createCharacter(parent: TNode, initialSkin?: CharacterSkinVisual): CharacterVisualHandle<TNode>;
}

/** 障碍/道具/装饰视觉绑定契约 */
export interface EntityVisualBinding<TNode = unknown> {
    readonly kind: string;
    readonly node: TNode;
    setLod?(lod: LodLevel): void;
}

/** 场景资产绑定器：允许将程序化几何体替换为 Prefab/glTF 模块化地块与障碍 */
export interface SceneAssetBinder<TNode = unknown> {
    readonly binderId: string;
    createObstacleNode?(parent: TNode, obstacleDefId: string, themeIdx: number): TNode | null;
    createItemNode?(parent: TNode, itemKind: string): TNode | null;
    createPropNode?(parent: TNode, propKind: string, themeIdx: number): TNode | null;
    createTileDecorNode?(parent: TNode, tileId: string, themeIdx: number): TNode | null;
}

/** 从 SkinDef 构造纯视觉投影 */
export function toCharacterSkinVisual(skin: Pick<SkinDef, 'id' | 'bodyTint' | 'staffTint' | 'accessories'>): CharacterSkinVisual {
    return {
        id: skin.id,
        bodyTint: [skin.bodyTint[0], skin.bodyTint[1], skin.bodyTint[2]],
        staffTint: [skin.staffTint[0], skin.staffTint[1], skin.staffTint[2]],
        accessories: skin.accessories,
    };
}

/** 渲染层运行时资源统计快照（开发期监控与自动化泄漏检查） */
export interface RenderResourceStats {
    activeSegments: number;
    activeObstacles: number;
    activeFragments: number;
    activeItems: number;
    activeProps: number;
    activePuffs: number;
    dynamicSegmentMeshes: number;
    cachedMaterials: number;
    pooledEntityNodes: number;
    pooledDecorNodes: number;
    pooledSegmentNodes: number;
    pooledPuffNodes: number;
}

/** 开发期资源分配/释放追踪器（用于检测重复开局或销毁后的对象泄漏） */
export class ResourceTracker {
    private live = new Map<string, number>();
    private peak = new Map<string, number>();
    private snapshots: RenderResourceStats[] = [];

    alloc(category: string, count = 1): void {
        const next = (this.live.get(category) ?? 0) + count;
        this.live.set(category, next);
        if (next > (this.peak.get(category) ?? 0)) this.peak.set(category, next);
    }

    free(category: string, count = 1): void {
        const next = (this.live.get(category) ?? 0) - count;
        this.live.set(category, next);
    }

    liveCount(category: string): number {
        return this.live.get(category) ?? 0;
    }

    peakCount(category: string): number {
        return this.peak.get(category) ?? 0;
    }

    recordSnapshot(stats: RenderResourceStats): void {
        this.snapshots.push({ ...stats });
    }

    getSnapshots(): readonly RenderResourceStats[] {
        return this.snapshots;
    }

    /** 检查是否全部已释放（destroy 后应为 true） */
    isAllFreed(): boolean {
        for (const v of this.live.values()) {
            if (v !== 0) return false;
        }
        return true;
    }

    reset(): void {
        this.live.clear();
        this.peak.clear();
        this.snapshots.length = 0;
    }
}
