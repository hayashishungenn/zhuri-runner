/** 可播种随机源：运行时用系统随机，测试/单局主种子用可复现 PRNG 与独立子流。零 cc 依赖。 */

export interface Rng {
    /** 返回 [0,1) */
    next(): number;
}

export class SystemRng implements Rng {
    next(): number { return Math.random(); }
}

/** 独立随机流盐值（主种子派生地图/障碍/掉落/装饰 4 条互不干扰的流） */
export const RNG_STREAM = {
    MAP: 0x9E3779B9,
    OBSTACLE: 0x85EBCA6B,
    DROP: 0xC2B2AE35,
    DECOR: 0x27D4EB2F,
} as const;

/** SplitMix32 域分离混合：同一主种子 + 不同盐值 → 独立子种子 */
export function deriveSeed(masterSeed: number, salt: number): number {
    let z = ((masterSeed >>> 0) ^ (salt >>> 0)) >>> 0;
    z = (z + 0x9E3779B9) >>> 0;
    z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
}

/** Mulberry32 —— 小而快的可播种 PRNG */
export class SeededRng implements Rng {
    readonly initialSeed: number;
    private s: number;
    constructor(seed: number) {
        this.initialSeed = seed >>> 0;
        this.s = this.initialSeed;
    }
    reset(seed?: number): void {
        this.s = (seed !== undefined ? seed : this.initialSeed) >>> 0;
    }
    next(): number {
        this.s = (this.s + 0x6D2B79F5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
