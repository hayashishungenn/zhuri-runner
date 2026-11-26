/**
 * Phase 8 主要 UI 流程自动化（Node 环境 + cc 最小桩）：
 * HUD 命中区、页面 action 路由、教程跳过、静音/暂停/复活/广告翻倍入口。
 * 桩仅覆盖布局与命中所需 API，不模拟渲染；真实渲染仍由浏览器/真机人工验证。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('cc', () => {
    const noop = () => {};
    const comp = () => new Proxy({} as Record<string, unknown>, {
        get(t, k) { return typeof k === 'string' && k in t ? t[k] : noop; },
        set(t, k, v) { if (typeof k === 'string') t[k] = v; return true; },
    });
    class Color {
        constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
        set(r: number, g: number, b: number, a: number) { this.r = r; this.g = g; this.b = b; this.a = a; return this; }
    }
    class StubNode {
        name: string;
        active = true;
        layer = 0;
        children: StubNode[] = [];
        parent: StubNode | null = null;
        position = { x: 0, y: 0, clone() { return { x: this.x, y: this.y }; } };
        constructor(name = '') { this.name = name; }
        setParent(p: StubNode | null) {
            if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
            this.parent = p;
            if (p) p.children.push(this);
        }
        addChild(n: StubNode) { n.setParent(this); return n; }
        setPosition(x: number, y: number) { this.position.x = x; this.position.y = y; }
        setScale() {}
        setRotationFromEuler() {}
        destroy() { this.setParent(null); }
        getComponent() { return comp(); }
        addComponent(type: unknown) {
            const c = comp();
            if (type === LabelStub) c.node = this;
            return c;
        }
    }
    class LabelStub {
        static HorizontalAlign = { CENTER: 1 };
        string = '';
        fontSize = 0;
        color = new Color();
        node!: StubNode;
    }
    return {
        Node: StubNode,
        Color,
        Graphics: comp(),
        Label: LabelStub,
        UITransform: comp(),
        UIOpacity: comp(),
        Layers: { Enum: { DEFAULT: 0, UI_2D: 1 } },
    };
});

import { Hud2D } from '../assets/scripts/render/Hud2D';
import { GameCore } from '../assets/scripts/core/GameCore';
import { SeededRng } from '../assets/scripts/core/rng';
import { DEFAULT_CONFIG as CFG } from '../assets/scripts/config/GameConfigSchema';
import { Node, Color } from 'cc';

function makeHud(ads = true) {
    // CFG 当前为测试期默认（ad.enabled=false）；按参数显式构造两种模式
    const cfg = { ...CFG, ad: { ...CFG.ad, enabled: ads } };
    const hud = new Hud2D(new Node('root') as never, cfg);
    const core = new GameCore(CFG, new SeededRng(1));
    return { hud, core };
}

describe('HUD 命中与 UI 流程（Phase 8）', () => {
    it('标题/奔跑/暂停/死亡按钮命中区分状态（广告开启）', () => {
        const { hud, core } = makeHud();
        expect(hud.hitTestButtons(225, 461, core)).toBe('start');
        core.startRun();
        expect(hud.hitTestButtons(225, 461, core)).toBe(null);
        expect(hud.hitTestButtons(375, 41, core)).toBe('pause');
        core.pause();
        expect(hud.hitTestButtons(225, 482, core)).toBe('resume');
        core.resume();
        core.state = 'dead';
        expect(hud.hitTestButtons(225, 482, core)).toBe('revive');
        expect(hud.hitTestButtons(225, 517, core)).toBe('doubleCoins');
        expect(hud.hitTestButtons(225, 555, core)).toBe('restart');
        core.reviveUsed = true;
        expect(hud.hitTestButtons(225, 482, core)).toBe(null);
    });

    it('广告关闭（ad.enabled=false）：全部广告入口隐藏，重开占用复活位', () => {
        const { hud, core } = makeHud(false);
        expect(hud.hitNavButton(340, 650)).toBe(null);        // 「奖励」页隐藏
        core.state = 'dead';
        expect(hud.hitTestButtons(225, 482, core)).toBe('restart');   // 复活位 → 重开
        expect(hud.hitTestButtons(225, 517, core)).toBe(null);        // 金币 ×2 消失
        expect(hud.hitTestButtons(225, 555, core)).toBe(null);        // 原重开位失效
        expect(hud.hitTestButtons(427, 41, core)).toBe('mute');       // 静音不受影响
    });

    it('静音状态可同步（启动恢复存档静音）', () => {
        const { hud } = makeHud();
        expect(hud.isMutedVisual).toBe(false);
        hud.syncMuted(true);
        expect(hud.isMutedVisual).toBe(true);
    });

    it('静音按钮全局命中', () => {
        const { hud, core } = makeHud();
        expect(hud.hitTestButtons(427, 41, core)).toBe('mute');
    });

    it('七个导航页 + 广告奖励页命中', () => {
        const { hud } = makeHud();
        expect(hud.hitNavButton(100, 570)).toBe('quests');
        expect(hud.hitNavButton(200, 570)).toBe('achievements');
        expect(hud.hitNavButton(340, 570)).toBe('shop');
        expect(hud.hitNavButton(100, 610)).toBe('upgrades');
        expect(hud.hitNavButton(200, 610)).toBe('records');
        expect(hud.hitNavButton(340, 610)).toBe('settings');
        expect(hud.hitNavButton(100, 650)).toBe('tutorial');
        expect(hud.hitNavButton(340, 650)).toBe('adrewards');
    });

    it('页面行 action 与返回按钮命中', () => {
        const { hud } = makeHud();
        hud.openPage('adrewards', '广告奖励', [
            { label: '金币 ×2', action: 'ad:doubleCoins' },
            { label: '限时神通', action: 'ad:timedPower' },
        ]);
        expect(hud.pageTap(100, 70)).toBe('__back__');
        expect(hud.pageTap(100, 300)).toBe('ad:doubleCoins');
        expect(hud.pageTap(100, 344)).toBe('ad:timedPower');
        hud.closePage();
        expect(hud.pageTap(100, 300)).toBe(null);
    });

    it('教程跳过命中仅在显示时有效', () => {
        const { hud } = makeHud();
        expect(hud.hitTutorialSkip(360, 140)).toBe(false);
        hud.showTutorialHint('切道', true);
        expect(hud.hitTutorialSkip(360, 140)).toBe(true);
        hud.hideTutorialHint();
        expect(hud.hitTutorialSkip(360, 140)).toBe(false);
    });

    it('换肤按钮命中与每帧更新不抛错', () => {
        const { hud, core } = makeHud();
        expect(hud.hitSkinButton(390, 430)).toBe(true);
        core.startRun();
        hud.setHandlers({});
        hud.showPop(225, 300, '+1', false, new Color(255, 0, 0, 255));
        hud.update(1 / 60, core);
    });
});
