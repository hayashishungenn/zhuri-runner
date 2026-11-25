/** 可播种随机源：运行时用系统随机，测试用固定种子保证确定性。零 cc 依赖。 */

export interface Rng {
    /** 返回 [0,1) */
    next(): number;
}

export class SystemRng implements Rng {
    next(): number { return Math.random(); }
}

/** Mulberry32 —— 小而快的可播种 PRNG */
export class SeededRng implements Rng {
    private s: number;
    constructor(seed: number) { this.s = seed >>> 0; }
    next(): number {
        this.s = (this.s + 0x6D2B79F5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
