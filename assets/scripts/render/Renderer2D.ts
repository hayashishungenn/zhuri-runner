/**
 * Renderer2D —— Graphics 伪3D 渲染（P0 视觉完整移植，回退用）。
 * 只读核心状态做呈现；粒子/抖动为本层视觉副作用。
 */
import { Node, Graphics, Color, Layers } from 'cc';
import { GameConfig } from '../config/GameConfigSchema';
import { ObstacleCatalog } from '../config/ObstacleCatalog';
import { GameCore } from '../core/GameCore';
import { AdService } from '../platform/AdService';
import { IRenderer } from './IRenderer';
import { Hud2D } from './Hud2D';
import { ScreenFx } from './ScreenFx';
import { LX, LY, HORIZON, PLAYER_Y, LOGICAL_W } from './layout';

interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; }

export class Renderer2D implements IRenderer {
    private cfg: GameConfig;
    private worldG: Graphics = null!;
    private puffs: Puff[] = [];
    private fx = new ScreenFx();
    // P0 透视参数
    private static readonly PROJ_K = 1.1;

    private catalog: ObstacleCatalog | null;
    constructor(parent: Node, cfg: GameConfig, catalog?: ObstacleCatalog) {
        this.cfg = cfg;
        this.catalog = catalog ?? null;
        const n = new Node('world2d');
        n.layer = Layers.Enum.UI_2D;
        n.setParent(parent);
        this.worldG = n.addComponent(Graphics);
    }

    render(core: GameCore, _ad: AdService, dt: number, hud: Hud2D) {
        this.fx.update(dt, core.state, core.timeScale);
        const fdt = core.state === 'dying' ? dt * core.timeScale : dt;
        this.updatePuffs(fdt);
        this.draw(core);
        hud.render(core, _ad, this.fx.slowAmt(core.timeScale), this.fx.redFlash);
    }

    onCoreEvents(events: ReturnType<GameCore['drainEvents']>) {
        this.fx.onEvents(events);
        for (const e of events) {
            if (e.type === 'crash') this.burst();
            else if (e.type === 'fragment' || e.type === 'jump' || e.type === 'land' || e.type === 'slideStart' || e.type === 'stumble') this.dust();
        }
    }

    destroy() { /* 2D 节点挂在 Canvas 下，随场景销毁 */ }

    // ---------- 粒子 ----------
    private dust() {
        for (let i = 0; i < 7; i++) {
            this.puffs.push({
                x: LOGICAL_W / 2 + (Math.random() - 0.5) * 46, y: PLAYER_Y - 4,
                vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40,
                life: 0, max: 0.5 + Math.random() * 0.3, r: 3 + Math.random() * 5,
            });
        }
    }
    private burst() {
        for (let i = 0; i < 16; i++) {
            this.puffs.push({
                x: LOGICAL_W / 2 + (Math.random() - 0.5) * 60, y: PLAYER_Y - 30 - Math.random() * 40,
                vx: (Math.random() - 0.5) * 160, vy: -40 - Math.random() * 90,
                life: 0, max: 0.7, r: 4 + Math.random() * 7,
            });
        }
    }
    private updatePuffs(dt: number) {
        for (let i = this.puffs.length - 1; i >= 0; i--) {
            const q = this.puffs[i];
            q.life += dt;
            if (q.life > q.max) { this.puffs.splice(i, 1); continue; }
            q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 140 * dt;
        }
    }

    // ---------- 投影 ----------
    private proj(z: number) { return Renderer2D.PROJ_K / (Renderer2D.PROJ_K + Math.max(z, 0)); }
    private sxLane(laneF: number, s: number) { return LX(LOGICAL_W / 2 + laneF * this.cfg.world.laneWidth * s); }
    private sy(z: number) { return LY(HORIZON + (PLAYER_Y - HORIZON) * this.proj(z)); }
    private col(r: number, g: number, b: number, a: number) { return new Color(r, g, b, a); }
    private grad(c1: number[], c2: number[], t: number): number[] {
        return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
    }

    // ---------- 世界绘制 ----------
    private draw(core: GameCore) {
        const g = this.worldG;
        g.clear();
        const p = core.skyP;
        const S = 1.6;
        // 抖动：整体节点微移
        if (this.fx.shake > 0.3) g.node.setPosition((Math.random() - 0.5) * this.fx.shake * S, (Math.random() - 0.5) * this.fx.shake * S, 0);
        else g.node.setPosition(0, 0, 0);

        // 天空（分段渐变）
        const bands = 12;
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            let c: number[];
            if (t < 0.45) c = this.grad([25, 18, 51], this.grad([90, 32, 40], [70, 40, 80], p), t / 0.45);
            else if (t < 0.8) c = this.grad(this.grad([90, 32, 40], [70, 40, 80], p), this.grad([196, 78, 36], [160, 60, 44], p), (t - 0.45) / 0.35);
            else c = this.grad(this.grad([196, 78, 36], [160, 60, 44], p), this.grad([255, 154, 60], [255, 130, 60], p), (t - 0.8) / 0.2);
            const y0 = LY(-20 + (HORIZON + 40) * (i / bands));
            const y1 = LY(-20 + (HORIZON + 40) * ((i + 1) / bands));
            g.fillColor = this.col(c[0], c[1], c[2], 255);
            g.rect(-360, y1, 720, y0 - y1 + 1);
            g.fill();
        }
        // 星星
        for (let i = 0; i < 24; i++) {
            const stx = (i * 97 + 31) % 450, sty = 30 + (i * 53 + 17) % 210;
            g.fillColor = this.col(255, 255, 255, Math.floor((0.18 + 0.2 * Math.sin(core.gTime * (1 + i % 3) + i)) * 255));
            g.circle(LX(stx), LY(sty), 1.6);
            g.fill();
        }
        // 太阳
        const sunR = 52 + p * 46 + Math.sin(core.gTime * 1.2) * 2;
        const sunX = LX(LOGICAL_W / 2), sunY = LY(HORIZON - 26);
        for (let i = 3; i >= 1; i--) {
            g.fillColor = this.col(255, 120, 40, 26 * (4 - i));
            g.circle(sunX, sunY, sunR * (0.9 + i * 0.55));
            g.fill();
        }
        g.fillColor = this.col(255, 217, 138, 255);
        g.circle(sunX, sunY, sunR); g.fill();
        g.fillColor = this.col(255, 244, 214, 190);
        g.circle(sunX - sunR * 0.2, sunY + sunR * 0.2, sunR * 0.55); g.fill();
        g.fillColor = this.col(255, 190, 100, 76);
        g.rect(-360, LY(HORIZON + 3), 720, 5 * S); g.fill();

        // 远山
        this.ridge(g, [[-20, 376], [70, 344], [150, 382], [220, 410], [300, 370], [370, 336], [470, 386]], this.col(60, 22, 20, 230));
        this.ridge(g, [[-20, 398], [90, 370], [190, 404], [290, 420], [400, 392], [470, 406]], this.col(40, 16, 14, 242));

        // 跑道
        const halfLanes = this.cfg.world.runwayHalf / this.cfg.world.laneWidth;
        const steps = 22;
        const ptsL: number[][] = [], ptsR: number[][] = [];
        for (let k = 0; k <= steps; k++) {
            const zz = this.cfg.world.spawnZ * (1 - k / steps);
            const s = this.proj(zz);
            const yy = HORIZON + (PLAYER_Y - HORIZON) * s;
            ptsL.push([this.sxLane(-halfLanes, s), LY(yy)]);
            ptsR.push([this.sxLane(halfLanes, s), LY(yy)]);
        }
        g.fillColor = this.col(58, 34, 20, 255);
        g.moveTo(ptsL[0][0], ptsL[0][1]);
        for (const pt of ptsL) g.lineTo(pt[0], pt[1]);
        for (let k = ptsR.length - 1; k >= 0; k--) g.lineTo(ptsR[k][0], ptsR[k][1]);
        g.close(); g.fill();
        // 车道虚线
        g.lineWidth = 3; g.strokeColor = this.col(255, 210, 140, 72);
        for (let j = -1; j <= 1; j += 2) {
            let started = false;
            for (let k = 0; k <= steps; k++) {
                const zz2 = this.cfg.world.spawnZ * (1 - k / steps);
                if (((zz2 * 1.4 + core.gTime * 2) % 2.2) > 1.1) continue;
                const s = this.proj(zz2);
                const yy = HORIZON + (PLAYER_Y - HORIZON) * s;
                const x1 = this.sxLane(j * 0.5, s);
                if (!started) { g.moveTo(x1, LY(yy)); started = true; } else g.lineTo(x1, LY(yy));
            }
            g.stroke();
        }
        // 路缘
        g.lineWidth = 5; g.strokeColor = this.col(255, 170, 90, 128);
        g.moveTo(ptsL[0][0], ptsL[0][1]);
        for (const pt of ptsL) g.lineTo(pt[0], pt[1]);
        g.stroke();
        g.moveTo(ptsR[0][0], ptsR[0][1]);
        for (const pt of ptsR) g.lineTo(pt[0], pt[1]);
        g.stroke();

        // 场景物（按深度排序）
        const scene: { z: number; kind: 'prop' | 'ob' | 'frag'; o: unknown }[] = [];
        for (const o of core.props) scene.push({ z: o.z, kind: 'prop', o });
        for (const o of core.obstacles) scene.push({ z: o.z, kind: 'ob', o });
        for (const o of core.fragments) if (!o.got) scene.push({ z: o.z, kind: 'frag', o });
        scene.sort((a, b) => b.z - a.z);
        for (const it of scene) {
            const s2 = this.proj(it.z);
            const oy = HORIZON + (PLAYER_Y - HORIZON) * s2;
            if (it.kind === 'prop') {
                const pr = it.o as { x: number; kind: string; s: number; sway: number };
                const px = this.sxLane(pr.x, s2);
                const th = 120 * pr.s * s2 * S;
                const swy = Math.sin(core.gTime * 1.6 + pr.sway) * 4 * s2 * S;
                g.fillColor = this.col(29, 14, 8, 255);
                g.rect(px - 10 * s2, LY(oy), 20 * s2, th);
                g.fill();
                g.circle(px + swy, LY(oy) + th + 18 * pr.s * s2 * S, 40 * pr.s * s2 * S * 0.6);
                g.fill();
            } else if (it.kind === 'ob') {
                const ob = it.o as { lane: number; defId: string };
                const def = this.catalog?.obstacles.find((x) => x.id === ob.defId);
                const ox = this.sxLane(ob.lane, s2), oyLY = LY(oy);
                g.fillColor = this.col(0, 0, 0, 76);
                g.ellipse(ox, oyLY, 40 * s2 * S, 10 * s2 * S);
                g.fill();
                const tint = def?.tint ?? [58, 36, 20];
                const vis = def?.vis ?? 'rock';
                if (vis === 'gap' || vis === 'water' || vis === 'bridge') {
                    // 地面带状（暗渊/水/断桥）：贴地色带
                    g.fillColor = this.col(tint[0], tint[1], tint[2], 230);
                    g.rect(ox - 42 * s2 * S, oyLY, 84 * s2 * S, 12 * s2 * S); g.fill();
                } else if (vis === 'fire') {
                    g.fillColor = this.col(tint[0], tint[1], tint[2], 240);
                    g.moveTo(ox - 26 * s2 * S, oyLY); g.lineTo(ox, oyLY + 52 * s2 * S); g.lineTo(ox + 26 * s2 * S, oyLY);
                    g.close(); g.fill();
                } else if (vis === 'wall' || vis === 'arch' || vis === 'fence') {
                    g.fillColor = this.col(58, 36, 20, 255);
                    g.moveTo(ox - 40 * s2 * S, oyLY);
                    g.lineTo(ox - 26 * s2 * S, oyLY + 34 * s2 * S);
                    g.lineTo(ox - 4 * s2 * S, oyLY + 44 * s2 * S);
                    g.lineTo(ox + 24 * s2 * S, oyLY + 30 * s2 * S);
                    g.lineTo(ox + 40 * s2 * S, oyLY);
                    g.close(); g.fill();
                    g.fillColor = this.col(tint[0] + 40, tint[1] + 30, tint[2] + 20, 90);
                    g.moveTo(ox - 26 * s2 * S, oyLY + 34 * s2 * S); g.lineTo(ox - 4 * s2 * S, oyLY + 44 * s2 * S); g.lineTo(ox + 2 * s2 * S, oyLY + 20 * s2 * S);
                    g.close(); g.fill();
                } else if (vis === 'log' || vis === 'beam' || vis === 'vine') {
                    g.fillColor = this.col(44, 24, 13, 255);
                    g.rect(ox - 44 * s2 * S, oyLY, 8 * s2 * S, 70 * s2 * S); g.fill();
                    g.rect(ox + 36 * s2 * S, oyLY, 8 * s2 * S, 70 * s2 * S); g.fill();
                    g.fillColor = this.col(64, 34, 15, 255);
                    g.rect(ox - 52 * s2 * S, oyLY + 70 * s2 * S, 104 * s2 * S, 16 * s2 * S); g.fill();
                    g.lineWidth = 3; g.strokeColor = this.col(255, 209, 102, 204);
                    g.moveTo(ox - 44 * s2 * S, oyLY + 96 * s2 * S); g.lineTo(ox + 44 * s2 * S, oyLY + 96 * s2 * S); g.stroke();
                } else {
                    g.fillColor = this.col(tint[0], tint[1], tint[2], 255);
                    g.moveTo(ox - 52 * s2 * S, oyLY);
                    g.lineTo(ox - 44 * s2 * S, oyLY + 96 * s2 * S);
                    g.lineTo(ox - 10 * s2 * S, oyLY + 118 * s2 * S);
                    g.lineTo(ox + 34 * s2 * S, oyLY + 104 * s2 * S);
                    g.lineTo(ox + 52 * s2 * S, oyLY + 40 * s2 * S);
                    g.lineTo(ox + 50 * s2 * S, oyLY);
                    g.close(); g.fill();
                    g.fillColor = this.col(0, 0, 0, 90);
                    g.rect(ox - 6 * s2 * S, oyLY, 10 * s2 * S, 40 * s2 * S); g.fill();
                }
            } else {
                const fg = it.o as { lane: number; z: number };
                const fx2 = this.sxLane(fg.lane, s2);
                const fy = LY(oy - 34 * s2) + Math.sin(core.gTime * 5 + fg.z) * 4 * s2 * S;
                for (let i2 = 2; i2 >= 0; i2--) {
                    g.fillColor = this.col(255, 150, 40, 30 * (3 - i2));
                    g.circle(fx2, fy, 16 * s2 * S * (0.5 + i2 * 0.4));
                    g.fill();
                }
                g.fillColor = this.col(255, 209, 102, 255);
                g.moveTo(fx2, fy + 7 * s2 * S);
                g.quadraticCurveTo(fx2 + 6 * s2 * S, fy, fx2, fy - 7 * s2 * S);
                g.quadraticCurveTo(fx2 - 6 * s2 * S, fy, fx2, fy + 7 * s2 * S);
                g.fill();
            }
        }
        // 灰尘
        for (const q of this.puffs) {
            g.fillColor = this.col(138, 106, 72, Math.floor(Math.max(0, 1 - q.life / q.max) * 128));
            g.circle(LX(q.x), LY(q.y), q.r * S);
            g.fill();
        }
        // 夸父
        this.drawKuafu(g, core);
        // 速度线
        if (core.speed > 19 && core.state === 'run') {
            g.lineWidth = 3; g.strokeColor = this.col(255, 230, 190, 64);
            for (let i = 0; i < 8; i++) {
                const a2 = (i / 8) * 6.283 + core.gTime * 3;
                const r1 = 180 + Math.sin(core.gTime * 6 + i * 2) * 20;
                const cx = LX(LOGICAL_W / 2), cy = LY(400);
                g.moveTo(cx + Math.cos(a2) * r1 * S, cy + Math.sin(a2) * r1 * S);
                g.lineTo(cx + Math.cos(a2) * (r1 + 60) * S, cy + Math.sin(a2) * (r1 + 60) * S);
                g.stroke();
            }
        }
    }

    private ridge(g: Graphics, pts: number[][], c: Color) {
        g.fillColor = c;
        g.moveTo(LX(-20), LY(HORIZON));
        for (const pt of pts) g.lineTo(LX(pt[0]), LY(pt[1]));
        g.lineTo(LX(470), LY(HORIZON));
        g.close(); g.fill();
    }

    private drawKuafu(g: Graphics, core: GameCore) {
        const S = 1.6;
        const px = LX(LOGICAL_W / 2 + core.interpPlayerLaneF * this.cfg.world.laneWidth);
        const jt = core.interpJumpT;
        const air = jt >= 0;
        const hop = air ? Math.sin(jt * Math.PI) * 92 : 0;
        const sliding = core.slideT >= 0;
        const baseY = LY(PLAYER_Y - hop);
        // 影子
        g.fillColor = this.col(0, 0, 0, Math.max(30, 76 - hop * 0.6));
        g.ellipse(px, LY(PLAYER_Y) + 6, 34 * S - hop * 0.12, 9);
        g.fill();
        const body = this.col(26, 17, 10, core.invincible > 0 && Math.floor(core.gTime * 10) % 2 === 0 ? 90 : 255);
        g.fillColor = body;
        const torsoH = sliding ? 30 : 44;
        const cy = baseY;
        g.lineCap = Graphics.LineCap.ROUND;
        if (!sliding) {
            g.lineWidth = 12; g.strokeColor = body;
            const ls = air ? 0.5 : Math.sin(core.runPhase);
            const ls2 = air ? -0.4 : Math.sin(core.runPhase + Math.PI);
            g.moveTo(px, cy - 52 * S);
            g.lineTo(px + ls * 13 * S, cy - 26 * S + (air ? -10 * S : 0));
            g.lineTo(px + ls * 20 * S, cy - (air ? 6 * S : 2 * S));
            g.stroke();
            g.moveTo(px, cy - 52 * S);
            g.lineTo(px + ls2 * 13 * S, cy - 26 * S + (air ? -6 * S : 0));
            g.lineTo(px + ls2 * 20 * S, cy - (air ? 0 : 2 * S));
            g.stroke();
        } else {
            g.lineWidth = 12; g.strokeColor = body;
            g.moveTo(px - 10 * S, cy - 14 * S); g.lineTo(px + 20 * S, cy - 8 * S);
            g.stroke();
        }
        g.lineCap = Graphics.LineCap.BUTT;
        // 躯干
        g.ellipse(px, cy - 52 * S + torsoH * S * 0.35 + (sliding ? 14 * S : 0), 15 * S, torsoH * S * 0.62);
        g.fill();
        // 手臂
        if (!sliding) {
            const ay = cy - 52 * S + torsoH * S * 0.6;
            g.lineWidth = 10; g.lineCap = Graphics.LineCap.ROUND;
            g.moveTo(px, ay);
            g.lineTo(px - Math.sin(core.runPhase) * 14 * S - 6, ay - 20 * S);
            g.stroke();
            g.moveTo(px, ay);
            g.lineTo(px + Math.sin(core.runPhase) * 14 * S + 6, ay - 20 * S);
            g.stroke();
            g.lineCap = Graphics.LineCap.BUTT;
        }
        // 头 + 发髻
        const hy = cy - 52 * S + torsoH * S + 10 * S;
        g.circle(px, hy, 14 * S); g.fill();
        g.circle(px, hy + 13 * S, 6.5 * S); g.fill();
        // 桃木杖
        const a1 = -0.7 + Math.sin(core.runPhase) * 0.04;
        const cx0 = px, cy0 = hy - 4 * S;
        const dx = Math.cos(a1) * 26 * S, dy = Math.sin(a1) * 26 * S;
        g.lineWidth = 8; g.strokeColor = this.col(74, 44, 24, 255);
        g.moveTo(cx0 - dx, cy0 - dy); g.lineTo(cx0 + dx, cy0 + dy); g.stroke();
        g.lineWidth = 4; g.strokeColor = this.col(122, 74, 36, 255);
        g.circle(cx0 + dx, cy0 + dy, 6 * S); g.stroke();
    }
}
