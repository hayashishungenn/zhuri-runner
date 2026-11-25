import { describe, it, expect } from 'vitest';
import { MockAdService } from '../assets/scripts/platform/AdService';
import { DEFAULT_CONFIG } from '../assets/scripts/config/GameConfigSchema';

const CFG = DEFAULT_CONFIG;

describe('MockAdService（P0 时序等价）', () => {
    const DUR = CFG.ad.stepDuration;   // 0.85

    it('show → 3 步倒计时 → ✓ → 发奖', () => {
        const ad = new MockAdService(CFG);
        let rewarded = 0;
        ad.show(() => { rewarded++; });
        expect(ad.active).toBe(true);
        expect(ad.stepsLeft).toBe(3);
        expect(ad.done).toBe(false);

        ad.update(DUR); expect(ad.stepsLeft).toBe(2);
        ad.update(DUR); expect(ad.stepsLeft).toBe(1);
        ad.update(DUR); expect(ad.stepsLeft).toBe(0);
        expect(ad.done).toBe(true);
        expect(ad.active).toBe(true);       // ✓ 展示一拍
        expect(rewarded).toBe(0);

        ad.update(DUR);
        expect(ad.active).toBe(false);
        expect(rewarded).toBe(1);
    });

    it('不满一步不推进（dt 累计）', () => {
        const ad = new MockAdService(CFG);
        ad.show(() => {});
        ad.update(DUR / 2);
        expect(ad.stepsLeft).toBe(3);
        ad.update(DUR / 2);
        expect(ad.stepsLeft).toBe(2);
    });

    it('回调只发一次', () => {
        const ad = new MockAdService(CFG);
        let n = 0;
        ad.show(() => n++);
        for (let i = 0; i < 10; i++) ad.update(DUR);
        expect(n).toBe(1);
    });

    it('展示期间重复 show 被忽略', () => {
        const ad = new MockAdService(CFG);
        ad.show(() => {});
        ad.show(() => {});
        expect(ad.stepsLeft).toBe(3);
    });

    it('结束后可再次 show（新一轮复活仍由核心 reviveUsed 把关）', () => {
        const ad = new MockAdService(CFG);
        ad.show(() => {});
        for (let i = 0; i < 5; i++) ad.update(DUR);
        expect(ad.active).toBe(false);
        ad.show(() => {});
        expect(ad.active).toBe(true);
        expect(ad.stepsLeft).toBe(3);
    });
});
