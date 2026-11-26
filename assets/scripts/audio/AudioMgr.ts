/**
 * AudioMgr —— 音频管理（Phase 5）。
 * 资源：assets/resources/audio/*.wav（程序化原创合成，见 ASSET_LICENSES）。
 * - BGM/环境音循环播放；SFX 按名播放（多实例池，避免同帧截断）
 * - muted 状态与 HUD 静音按钮联动；微信端兼容 cc.AudioSource
 */
import { AudioClip, AudioSource, resources, Node } from 'cc';

const MAX_SFX_SOURCES = 8;

export type SfxName =
    | 'footstep_a' | 'footstep_b' | 'coin' | 'jump' | 'land' | 'slide' | 'hit'
    | 'death' | 'revive' | 'dash' | 'staff' | 'leap' | 'water' | 'shield'
    | 'magnet' | 'double' | 'turn' | 'ui' | 'pity';

export class AudioMgr {
    private root: Node;
    private bgmSource: AudioSource | null = null;
    private windSource: AudioSource | null = null;
    private clips = new Map<string, AudioClip>();
    private muted = false;
    private sfxPool: AudioSource[] = [];
    private loaded = false;

    constructor(parent: Node) {
        this.root = parent;
    }

    /** 异步预加载全部音频（一次性） */
    load(): Promise<void> {
        if (this.loaded) return Promise.resolve();
        return new Promise((resolve) => {
            resources.loadDir('audio', AudioClip, (err, clips) => {
                if (err) {
                    console.warn('[AudioMgr] 音频加载失败（将继续无声运行）:', err.message);
                } else {
                    for (const c of clips) this.clips.set(c.name, c);
                    this.loaded = true;
                    this.startBgm();
                }
                resolve();
            });
        });
    }

    private ensureBgm(): AudioSource {
        if (!this.bgmSource) {
            this.bgmSource = this.root.addComponent(AudioSource);
            this.bgmSource.playOnAwake = false;
            this.bgmSource.loop = true;
            this.bgmSource.volume = 0.6;
        }
        return this.bgmSource;
    }

    private startBgm() {
        const bgm = this.clips.get('bgm_main');
        const wind = this.clips.get('amb_wind');
        if (bgm && !this.muted) {
            const src = this.ensureBgm();
            src.clip = bgm;
            src.loop = true;
            src.play();
        }
        if (wind && !this.muted) {
            if (!this.windSource) {
                this.windSource = this.root.addComponent(AudioSource);
                this.windSource.playOnAwake = false;
                this.windSource.loop = true;
                this.windSource.volume = 0.35;
            }
            this.windSource.clip = wind;
            this.windSource.play();
        }
    }

    /** 静音切换（联动 HUD 静音按钮） */
    setMuted(m: boolean): void {
        this.muted = m;
        if (this.bgmSource) { if (m) this.bgmSource.stop(); else if (this.bgmSource.clip) this.bgmSource.play(); }
        if (this.windSource) { if (m) this.windSource.stop(); else if (this.windSource.clip) this.windSource.play(); }
        if (m) {
            for (const s of this.sfxPool) s.stop();
        }
    }

    get isMuted(): boolean { return this.muted; }

    /** 播放音效（使用独立 AudioSource，短暂音效互不打断） */
    playSfx(name: SfxName, volume = 1): void {
        if (this.muted) return;
        const clip = this.clips.get(name);
        if (!clip) return;
        const src = this.acquirePoolSource();
        src.clip = clip;
        src.volume = volume;
        src.play();
    }

    private acquirePoolSource(): AudioSource {
        for (const s of this.sfxPool) {
            if (!s.playing) return s;
        }
        if (this.sfxPool.length >= MAX_SFX_SOURCES) {
            // 池满：抢占最早实例，避免长时游戏每帧新增 AudioSource
            const s = this.sfxPool[0];
            s.stop();
            return s;
        }
        const s = this.root.addComponent(AudioSource);
        s.playOnAwake = false;
        this.sfxPool.push(s);
        return s;
    }

    /** 场景销毁：停止并释放全部音频组件与缓存 */
    destroy(): void {
        this.bgmSource?.stop();
        this.windSource?.stop();
        for (const s of this.sfxPool) s.stop();
        this.bgmSource?.destroy();
        this.windSource?.destroy();
        for (const s of this.sfxPool) s.destroy();
        this.sfxPool.length = 0;
        this.clips.clear();
        this.bgmSource = null;
        this.windSource = null;
        this.loaded = false;
    }
}
