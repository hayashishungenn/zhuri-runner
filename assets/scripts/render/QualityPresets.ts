/**
 * QualityPresets —— 低/中/高画质档位（Phase 8 实测后固化）。
 * 纯数据、零 cc 依赖：只控制视觉密度，不参与玩法判定，可在 Node 单测验证档位单调性。
 */
export interface QualityPreset {
    sphereSeg: number;
    coneSeg: number;
    cylSeg: number;
    stars: number;
    dust: number;
    burst: number;
    /** 特殊地块装饰保留比例 0-1 */
    decorKeep: number;
}

export const QUALITY_PRESETS: Record<'low' | 'mid' | 'high', QualityPreset> = {
    low: { sphereSeg: 6, coneSeg: 6, cylSeg: 6, stars: 10, dust: 2, burst: 5, decorKeep: 0.35 },
    mid: { sphereSeg: 12, coneSeg: 10, cylSeg: 8, stars: 20, dust: 4, burst: 9, decorKeep: 0.7 },
    high: { sphereSeg: 16, coneSeg: 14, cylSeg: 10, stars: 30, dust: 6, burst: 14, decorKeep: 1 },
};
