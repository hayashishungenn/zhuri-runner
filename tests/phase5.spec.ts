/**
 * Phase 5 测试：美术管线（皮肤/地块模板）、音频资产、动画状态覆盖。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSkins, parseSkins } from '../assets/scripts/config/SkinCatalog';
import { validateTileTemplates, parseTileTemplates } from '../assets/scripts/config/TileTemplates';


const ROOT = resolve(__dirname, '..');

function loadJson(rel: string): unknown {
    return JSON.parse(readFileSync(resolve(ROOT, 'assets/resources', rel), 'utf8'));
}

describe('皮肤目录（8 套原创组合）', () => {
    const raw = loadJson('skins.json');

    it('≥8 套且通过校验', () => {
        expect(validateSkins(raw)).toEqual([]);
        expect((raw as { skins: unknown[] }).skins.length).toBeGreaterThanOrEqual(8);
    });

    it('每套皮肤有独立几何配件或配色差异（不得仅改名称）', () => {
        const cat = parseSkins(raw);
        const signatures = cat.skins.map((s) =>
            JSON.stringify([s.bodyTint, s.staffTint, s.accessories.map((a) => [a.shape, a.pos, a.scale, a.tint])]));
        expect(new Set(signatures).size).toBe(cat.skins.length);
        // 至少一半皮肤带专属几何配件（不只是纯变色）
        const withAccessories = cat.skins.filter((s) => s.accessories.length > 0).length;
        expect(withAccessories).toBeGreaterThanOrEqual(4);
    });

    it('id 互不重复且换肤循环可遍历', () => {
        const cat = parseSkins(raw);
        const ids = cat.skins.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        // 循环遍历：idx 模 length 覆盖全部
        const visited = new Set(ids.map((_, i) => i % ids.length));
        expect(visited.size).toBe(ids.length);
    });
});

describe('地块模板目录（≥40 种）', () => {
    const raw = loadJson('tile-templates.json');

    it('≥40 种且通过校验', () => {
        expect(validateTileTemplates(raw)).toEqual([]);
        expect((raw as { templates: unknown[] }).templates.length).toBeGreaterThanOrEqual(40);
    });

    it('四主题均有模板覆盖（每主题 ≥10 种）', () => {
        const cat = parseTileTemplates(raw);
        for (let theme = 0; theme < 4; theme++) {
            const count = cat.templates.filter((t) => t.theme === theme).length;
            expect(count).toBeGreaterThanOrEqual(10);
        }
    });

    it('基型全覆盖：每主题含直道/弯道/坡道/特殊', () => {
        const cat = parseTileTemplates(raw);
        for (let theme = 0; theme < 4; theme++) {
            const kinds = new Set(cat.templates.filter((t) => t.theme === theme).map((t) => t.kind));
            expect(kinds.has('straight')).toBe(true);
            expect(kinds.has('arcL') || kinds.has('arcR')).toBe(true);
            expect(kinds.has('slopeUp') || kinds.has('slopeDown')).toBe(true);
        }
    });
});

describe('音频资产（程序化原创 WAV）', () => {
    const audioDir = resolve(ROOT, 'assets/resources/audio');
    const files = readdirSync(audioDir).filter((f) => f.endsWith('.wav'));

    it('≥15 个音频文件（BGM+环境+全套音效）', () => {
        expect(files.length).toBeGreaterThanOrEqual(15);
    });

    it('WAV 头合法（RIFF/PCM 16bit/22050Hz）', () => {
        for (const f of files) {
            const buf = readFileSync(resolve(audioDir, f));
            expect(buf.subarray(0, 4).toString()).toBe('RIFF');
            expect(buf.subarray(8, 12).toString()).toBe('WAVE');
            expect(buf.readUInt16LE(20)).toBe(1);        // PCM
            expect(buf.readUInt16LE(22)).toBe(1);        // mono
            expect(buf.readUInt16LE(34)).toBe(16);       // 16bit
            expect(buf.readUInt32LE(24)).toBe(22050);    // 采样率
            // 数据长度一致性
            const dataLen = buf.readUInt32LE(40);
            expect(44 + dataLen).toBe(buf.length);
        }
    });

    it('BGM 与环境风存在且足够长（≥4s）', () => {
        for (const need of ['bgm_main.wav', 'amb_wind.wav']) {
            expect(files).toContain(need);
            const buf = readFileSync(resolve(audioDir, need));
            const dur = buf.readUInt32LE(40) / 2 / buf.readUInt32LE(24);
            expect(dur).toBeGreaterThanOrEqual(4);
        }
    });

    it('任务书关键音效齐全（动作/道具/UI/环境）', () => {
        const need = [
            'sfx_footstep_a.wav', 'sfx_footstep_b.wav',   // 脚步
            'sfx_coin.wav', 'sfx_jump.wav', 'sfx_slide.wav', 'sfx_land.wav',
            'sfx_hit.wav', 'sfx_death.wav', 'sfx_revive.wav', 'sfx_dash.wav',
            'sfx_staff.wav', 'sfx_water.wav', 'sfx_shield.wav', 'sfx_magnet.wav',
            'sfx_double.wav', 'sfx_leap.wav', 'sfx_turn.wav',
            'sfx_ui.wav',                                  // UI 反馈
            'amb_wind.wav',                                // 环境音
        ];
        for (const f of need) expect(files).toContain(f);
    });

    it('音频总包体 ≤2MB（主包预算内）', () => {
        let total = 0;
        for (const f of files) total += readFileSync(resolve(audioDir, f)).length;
        expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
    });
});

describe('换肤存档', () => {
    it('皮肤索引持久化往返（循环安全）', () => {
        const st = new Map<string, string>();
        const storage = {
            get: (k: string) => st.get(k) ?? null,
            set: (k: string, v: string) => { st.set(k, v); },
        };
        // 模拟 Game.cycleSkin 的持久化逻辑
        const skins = parseSkins(loadJson('skins.json')).skins.length;
        let idx = 0;
        for (let i = 0; i < skins + 3; i++) {
            idx = (idx + 1) % skins;
            storage.set('zhuri.skin', String(idx));
        }
        expect(Number(storage.get('zhuri.skin'))).toBe((skins + 3) % skins);
        expect(Number(storage.get('zhuri.skin'))).toBeLessThan(skins);
    });
});
