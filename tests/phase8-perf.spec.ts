/**
 * Phase 8 性能测量：画质档位单调性、静态 Draw Call 估算、构建产物体积。
 * 帧时间见 phase8-stress.spec.ts（Node 逻辑层 600s 实测）；GPU/真机帧率无法在 Node 测得。
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../assets/scripts/render/QualityPresets';
import { DEFAULT_CONFIG } from '../assets/scripts/config/GameConfigSchema';

const ROOT = resolve(__dirname, '..');

/** 静态节点估算：天空带+星+远山+太阳+地面+车道线+角色≈60；每段 3 个 Mesh + 装饰 */
function estimateDrawCalls(q: typeof QUALITY_PRESETS.mid, visibleSegments = 12): number {
    const sky = 10 + q.stars + 10 + 2 + 1 + 18;
    const character = 22;
    const segments = visibleSegments * (3 + Math.round(2 * q.decorKeep));
    return sky + character + segments;
}

describe('Phase 8 性能与画质档位', () => {
    it('低/中/高画质单调且配置默认中档', () => {
        const { low, mid, high } = QUALITY_PRESETS;
        expect(low.stars).toBeLessThan(mid.stars);
        expect(mid.stars).toBeLessThan(high.stars);
        expect(low.sphereSeg).toBeLessThan(mid.sphereSeg);
        expect(mid.coneSeg).toBeLessThan(high.coneSeg);
        expect(low.dust).toBeLessThan(mid.dust);
        expect(mid.burst).toBeLessThan(high.burst);
        expect(low.decorKeep).toBeLessThan(mid.decorKeep);
        expect(mid.decorKeep).toBeLessThan(high.decorKeep);
        expect(DEFAULT_CONFIG.quality.level).toBe('mid');
    });

    it('输出各档静态 Draw Call 估算与三角形粗估', () => {
        for (const [name, q] of Object.entries(QUALITY_PRESETS)) {
            const dc = estimateDrawCalls(q);
            // 每个球/锥/柱按 2×segments 三角形粗估（仅用于相对比较）
            const tri = (q.sphereSeg + q.coneSeg + q.cylSeg) * 2 * 60;
            console.log(`[phase8-perf] ${name}: drawCall≈${dc} tri≈${tri} stars=${q.stars} dust=${q.dust} decorKeep=${q.decorKeep}`);
            expect(dc).toBeGreaterThan(0);
        }
        expect(estimateDrawCalls(QUALITY_PRESETS.low)).toBeLessThan(estimateDrawCalls(QUALITY_PRESETS.high));
    });

    it('构建产物体积实测（业务 bundle / 资源 / 引擎）', () => {
        const root = resolve(ROOT, 'build/wechatgame');
        const main = statSync(resolve(root, 'assets/main/index.js')).size;
        const resources = statSync(resolve(root, 'assets/resources/config.json')).size;
        const engine = statSync(resolve(root, 'cocos-js/cc.js')).size;
        console.log(`[phase8-perf] bundle main=${(main / 1024).toFixed(1)}KB resources.import=${(resources / 1024).toFixed(1)}KB engine=${(engine / 1024).toFixed(1)}KB`);
        expect(main).toBeLessThan(500 * 1024);
        expect(resources).toBeLessThan(2 * 1024 * 1024);
        // 引擎与音频资源的真实体积不做乐观断言：微信主包 4MB 限制见 PHASE8_REPORT 风险清单
        const cfg = JSON.parse(readFileSync(resolve(ROOT, 'assets/resources/game-config.json'), 'utf8'));
        expect(cfg.quality.level).toBe('mid');
    });
});
