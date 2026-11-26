import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig, parseConfig, formatUi, DEFAULT_CONFIG } from '../assets/scripts/config/GameConfigSchema';

const ROOT = resolve(__dirname, '..');

function cloneWith(patch: (o: any) => void): unknown {
    const o = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    patch(o);
    return o;
}

describe('game-config（实际随包 JSON）', () => {
    it('assets/resources/game-config.json 通过校验', () => {
        const raw = JSON.parse(readFileSync(resolve(ROOT, 'assets/resources/game-config.json'), 'utf8'));
        const errs = validateConfig(raw);
        expect(errs).toEqual([]);
        expect(() => parseConfig(raw)).not.toThrow();
    });

    it('DEFAULT_CONFIG 自身一致（schema 与 JSON 基准不漂移）', () => {
        expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    });
});

describe('validateConfig 拒绝非法配置', () => {
    it('根节点非对象', () => {
        expect(validateConfig('x').length).toBeGreaterThan(0);
        expect(validateConfig(null).length).toBeGreaterThan(0);
    });

    it('缺少 section', () => {
        const o = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        delete (o as any).speed;
        const errs = validateConfig(o);
        expect(errs.some((e) => e.includes('speed'))).toBe(true);
    });

    it('renderMode 枚举', () => {
        const errs = validateConfig(cloneWith((o) => { o.renderMode = '2.5d'; }));
        expect(errs.some((e) => e.includes('renderMode'))).toBe(true);
    });

    it('quality.level 枚举（低/中/高画质档位）', () => {
        expect(validateConfig(cloneWith((o) => { o.quality.level = 'ultra'; })).some((e) => e.includes('quality.level'))).toBe(true);
        for (const lv of ['low', 'mid', 'high']) {
            expect(validateConfig(cloneWith((o) => { o.quality.level = lv; })).filter((e) => e.includes('quality.level'))).toHaveLength(0);
        }
    });

    it('ad.enabled 必须为布尔（广告总开关：false=可玩性测试期隐藏入口）', () => {
        expect(validateConfig(cloneWith((o) => { o.ad.enabled = 'no'; })).some((e) => e.includes('ad.enabled'))).toBe(true);
        expect(validateConfig(cloneWith((o) => { o.ad.enabled = true; })).filter((e) => e.includes('ad.enabled'))).toHaveLength(0);
    });

    it('广告位 ID 未配置是合法状态（禁止编造正式广告位）', () => {
        // Phase 7：空广告位表示"流量主未开通/未配置"，广告明确不可用，schema 不拒绝
        const cfg = cloneWith((o) => { o.ad.mode = 'wx'; });
        expect(validateConfig(cfg).filter((e) => e.includes('adUnitId'))).toHaveLength(0);
    });

    it('数值取值域（singleRowChance > 1）', () => {
        const errs = validateConfig(cloneWith((o) => { o.spawn.singleRowChance = 1.5; }));
        expect(errs.some((e) => e.includes('singleRowChance'))).toBe(true);
    });

    it('整数约束（fragmentCount 非整数）', () => {
        const errs = validateConfig(cloneWith((o) => { o.spawn.fragmentCount = 2.5; }));
        expect(errs.some((e) => e.includes('fragmentCount'))).toBe(true);
    });

    it('非有限数字', () => {
        const errs = validateConfig(cloneWith((o) => { o.speed.base = Infinity; }));
        expect(errs.some((e) => e.includes('speed.base'))).toBe(true);
    });

    it('跳窗逻辑：jumpSafeFrom >= jumpSafeTo', () => {
        const errs = validateConfig(cloneWith((o) => { o.player.jumpSafeFrom = 0.9; o.player.jumpSafeTo = 0.2; }));
        expect(errs.some((e) => e.includes('jumpSafe'))).toBe(true);
    });

    it('跨字段：spawnZ 必须大于 hitZ', () => {
        const errs = validateConfig(cloneWith((o) => { o.world.spawnZ = 0.1; }));
        expect(errs.some((e) => e.includes('spawnZ'))).toBe(true);
    });

    it('文案占位符：distLabel 丢失 {n}', () => {
        const errs = validateConfig(cloneWith((o) => { o.ui.distLabel = '已逐里'; }));
        expect(errs.some((e) => e.includes('distLabel'))).toBe(true);
    });

    it('ui 缺少键', () => {
        const errs = validateConfig(cloneWith((o) => { delete o.ui.title; }));
        expect(errs.some((e) => e.includes('ui.title'))).toBe(true);
    });

    it('parseConfig 抛聚合错误', () => {
        expect(() => parseConfig({})).toThrow(/game-config 非法/);
    });
});

describe('formatUi', () => {
    it('替换 {n} 占位符', () => {
        expect(formatUi('已逐 {n} 里', 42)).toBe('已逐 42 里');
        expect(formatUi('阳炎 × {n}', 0)).toBe('阳炎 × 0');
    });
});

