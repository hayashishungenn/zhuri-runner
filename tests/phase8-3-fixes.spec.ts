/**
 * Phase 8.3 修复回归：触控坐标换算（可见区左下角 UI 坐标）与默认静音后取消静音的 BGM 恢复。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => {
    class AudioSource {
        clip: { name: string } | null = null;
        playing = false;
        loop = false;
        playOnAwake = false;
        volume = 1;
        play() { this.playing = true; }
        stop() { this.playing = false; }
        destroy() {}
    }
    class Node {
        components: unknown[] = [];
        addComponent(type: unknown) {
            const c = type === AudioSource ? new AudioSource() : {};
            this.components.push(c);
            return c as never;
        }
    }
    return {
        Node,
        AudioSource,
        AudioClip: class AudioClip {},
        resources: {
            loadDir(_path: string, _type: unknown, cb: (err: null, clips: { name: string }[]) => void) {
                cb(null, [{ name: 'bgm_main' }, { name: 'amb_wind' }, { name: 'footstep_a' }]);
            },
        },
    };
});

import { uiToLogical } from '../assets/scripts/render/layout';
import { AudioMgr } from '../assets/scripts/audio/AudioMgr';
import { GameCore } from '../assets/scripts/core/GameCore';
import { GameSession } from '../assets/scripts/core/GameSession';
import { SeededRng } from '../assets/scripts/core/rng';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';
import { Save, Storage } from '../assets/scripts/platform/Save';
import { Node, AudioSource } from 'cc';

class MemStorage implements Storage {
    private m = new Map<string, string>();
    get(k: string) { return this.m.get(k) ?? null; }
    set(k: string, v: string) { this.m.set(k, v); }
}

describe('Phase 8.3 触控坐标换算', () => {
    it('可见区左下角 UI 坐标正确映射到逻辑坐标（横屏 720×540 校准数据）', () => {
        const p = uiToLogical(109.6875, 475.2421875, 720, 540);
        expect(p.gx).toBeCloseTo(68.5547, 3);
        expect(p.gy).toBeCloseTo(271.7232, 3);
    });

    it('开局按钮逻辑坐标 (225,461) 反推 UI 坐标后往返一致', () => {
        const ux = 225 * 1.6 - 720 / 2 + 720 / 2;
        const uy = 1280 / 2 + 540 / 2 - 461 * 1.6;
        const p = uiToLogical(ux, uy, 720, 540);
        expect(p.gx).toBeCloseTo(225, 5);
        expect(p.gy).toBeCloseTo(461, 5);
    });

    it('竖屏 720×1280 下 y 映射不偏移 400 逻辑像素', () => {
        const p = uiToLogical(360, 1280 - 461 * 1.6, 720, 1280);
        expect(p.gx).toBeCloseTo(225, 5);
        expect(p.gy).toBeCloseTo(461, 5);
    });
});

describe('Phase 8.3 教程步骤推进', () => {
    it('Session 内切道后教程从第一步推进到第二步', () => {
        const save = new Save(new MemStorage());
        const session = new GameSession({
            core: new GameCore(CFG, new SeededRng(1)),
            save,
            skinIds: ['kuafu'],
            today: () => '2026-11-26',
        });
        session.startRun('endless', { tutorial: true });
        expect(session.tutorial.step?.id).toBe('lane');
        session.submitCommand({ type: 'lane', dir: -1 });
        session.tick(1 / 60);
        expect(session.tutorial.step?.id).toBe('jump');
    });
});

describe('Phase 8.3 默认静音后取消静音', () => {
    it('取消静音会补建并播放 BGM/环境音，再次静音全部停止', async () => {
        const root = new Node();
        const audio = new AudioMgr(root as never);
        audio.setMuted(true);
        await audio.load();
        const sources = (root as unknown as { components: unknown[] }).components
            .filter((c): c is InstanceType<typeof AudioSource> => c instanceof AudioSource);
        expect(sources.every((s) => !s.playing)).toBe(true);
        audio.setMuted(false);
        const active = (root as unknown as { components: unknown[] }).components
            .filter((c): c is InstanceType<typeof AudioSource> => c instanceof AudioSource);
        expect(active.some((s) => s.clip?.name === 'bgm_main' && s.playing)).toBe(true);
        expect(active.some((s) => s.clip?.name === 'amb_wind' && s.playing)).toBe(true);
        audio.setMuted(true);
        expect(active.every((s) => !s.playing)).toBe(true);
    });
});
