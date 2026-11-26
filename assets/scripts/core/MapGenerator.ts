/**
 * MapGenerator —— 无限地图程序化生成（纯逻辑，零 cc 依赖）。
 *
 * 任务书要求：
 * - 基于入口/出口坐标自动拼接、方向转换、高度衔接（append 断言连续性）
 * - 可复现随机种子 + 带权重地块选择
 * - 约束：转弯频率（gapMin/gapMax）、连续重复控制、主题切换（themeEvery）、
 *   特殊地块出现条件（specialGap、非弯道/坡道邻接）
 * - 前方预生成（horizon）+ 后方回收（recycleBehind）：地块数量有界
 *
 * 地块类型：straight / slopeUp / slopeDown / arcL / arcR / bridge / cliff / cave / transition。
 * 每个 Segment 携带入口、出口、方向、长度、半宽、主题、障碍/装饰生成点、地形边界（见 track.ts）。
 */
import { SeededRng } from './rng';
import { SegmentKind, SegmentPath, TrackSegment, arcLength, normHeading } from './track';

export interface MapGenCfg {
    seed: number;
    turnsEnabled: boolean;
    /** 预生成距离（玩家前方，逻辑单位） */
    horizon: number;
    /** 回收距离（玩家身后） */
    recycleBehind: number;
    straightMin: number;
    straightMax: number;
    turnRadius: number;
    /** 转弯操作窗口（路口前开启距离，逻辑单位） */
    turnWindow: number;
    /** 转弯间隔 [gapMin, gapMax]（相邻两次转弯间的直线距离） */
    turnGapMin: number;
    turnGapMax: number;
    slopeChance: number;
    slopeMin: number;
    slopeMax: number;
    slopeGrade: number;
    bridgeChance: number;
    cliffChance: number;
    caveChance: number;
    /** 特殊地块最小间隔 */
    specialGap: number;
    /** 主题切换距离 */
    themeEvery: number;
}

/** 路口记录（转弯判定用） */
export interface Corner {
    /** 转弯判定点（弧线中点绝对距离） */
    d: number;
    /** +1 左转 / -1 右转 */
    dir: 1 | -1;
    /** 已成功转向 */
    passed: boolean;
}

interface GenCursor {
    x: number; y: number; z: number;
    heading: number;
    d: number;
}

export class MapGenerator {
    readonly path: SegmentPath;
    readonly corners: Corner[] = [];
    /** 累计生成的地块总数（trim 不影响，用于生成量统计/测试） */
    totalGenerated = 0;
    /** 难度 [0,1]：转弯间隔上限随难度向 gapMin+20 收缩 */
    difficulty = 0;
    private cfg: MapGenCfg;
    private rng: SeededRng;
    private cur: GenCursor;
    private theme = 0;
    private themeStartD = 0;
    private sinceTurnD = 0;     // 距上次转弯结束的直线距离
    private sinceSpecialD = 0;
    private lastKind: SegmentKind | null = null;
    private lastSlopeUp = false;

    constructor(cfg: MapGenCfg) {
        this.cfg = cfg;
        this.rng = new SeededRng(cfg.seed);
        this.path = new SegmentPath();
        this.cur = { x: 0, y: 0, z: 0, heading: 0, d: 0 };
    }

    /** 重开时以同种子重建路径（可复现） */
    reset(): void {
        this.rng = new SeededRng(this.cfg.seed);
        this.path.clear();
        this.corners.length = 0;
        this.cur = { x: 0, y: 0, z: 0, heading: 0, d: 0 };
        this.theme = 0;
        this.themeStartD = 0;
        this.sinceTurnD = 0;
        this.sinceSpecialD = 0;
        this.lastKind = null;
        this.lastSlopeUp = false;
        this.totalGenerated = 0;
    }

    /** 确保玩家前方 horizon 预生成完毕，并回收身后地块/路口 */
    update(playerD: number): void {
        while (this.cur.d - playerD < this.cfg.horizon) this.spawnNext();
        this.path.trim(playerD - this.cfg.recycleBehind);
        while (this.corners.length && this.corners[0].d < playerD - this.cfg.recycleBehind) this.corners.shift();
    }

    private pickLength(min: number, max: number): number {
        return min + this.rng.next() * (max - min);
    }

    /** 生成下一个地块（带约束的加权选择） */
    private spawnNext(): void {
        const c = this.cfg;
        let kind: SegmentKind = 'straight';
        let length = this.pickLength(c.straightMin, c.straightMax);
        let grade = 0;
        let turn: 0 | 1 | -1 = 0;
        let radius = 0;

        // 1) 转弯判定：间隔到达上限强制转弯；到达下限后按权重
        const gapMaxEff = c.turnGapMax + (c.turnGapMin + 20 - c.turnGapMax) * this.difficulty;
        const mustTurn = c.turnsEnabled && this.sinceTurnD >= gapMaxEff;
        const mayTurn = c.turnsEnabled && this.sinceTurnD >= c.turnGapMin
            && this.rng.next() < 0.5
            && this.lastKind !== 'slopeUp' && this.lastKind !== 'slopeDown';
        if (mustTurn || mayTurn) {
            turn = this.rng.next() < 0.5 ? 1 : -1;
            kind = turn === 1 ? 'arcL' : 'arcR';
            radius = c.turnRadius;
            length = arcLength(radius);
        } else if (this.sinceSpecialD >= c.specialGap) {
            // 2) 特殊地块（间隔满足后按权重抽取；坡道后不接特殊）
            const r = this.rng.next();
            const total = c.bridgeChance + c.cliffChance + c.caveChance;
            if (r < c.bridgeChance / total && this.lastKind !== 'slopeUp' && this.lastKind !== 'slopeDown') kind = 'bridge';
            else if (r < (c.bridgeChance + c.cliffChance) / total) kind = 'cliff';
            else kind = 'cave';
            length = this.pickLength(c.straightMin * 0.8, c.straightMax * 0.9);
        } else if (this.rng.next() < c.slopeChance
            && this.lastKind !== 'arcL' && this.lastKind !== 'arcR'
            && this.lastKind !== 'bridge' && this.lastKind !== 'cave') {
            // 3) 坡道：上下交替倾向（避免连续同向叠加过高）
            kind = this.lastSlopeUp ? 'slopeDown' : (this.rng.next() < 0.65 ? 'slopeUp' : 'slopeDown');
            grade = c.slopeGrade * (kind === 'slopeDown' ? -1 : 1);
            if (this.lastKind === 'slopeUp') { kind = 'slopeDown'; grade = -c.slopeGrade; }
            if (this.lastKind === 'slopeDown') { kind = 'slopeUp'; grade = c.slopeGrade; }
            length = this.pickLength(c.slopeMin, c.slopeMax);
        }

        // 4) 主题切换：距离到达即在新地块上生效（50% 概率把普通直线替换为过渡地块）
        //    注意：不得替换弧线/坡道/特殊地块——kind 与 length/radius 必须保持一致
        if (this.cur.d - this.themeStartD >= c.themeEvery) {
            this.theme++;
            this.themeStartD = this.cur.d;
            if (kind === 'straight' && this.rng.next() < 0.5) {
                kind = 'transition';
                length = this.pickLength(6, 9);
            }
        }

        // 5) 宽度变体（直线/坡道才变宽窄；弯道固定全宽）
        const widths = [1, 1, 1, 0.85];
        const halfWidth = 2.94 * (turn !== 0 ? 1 : widths[Math.floor(this.rng.next() * widths.length)]);

        // 6) 生成点与地形边界
        const allowsObstacles = turn === 0 && kind !== 'bridge' && kind !== 'cave' && kind !== 'transition';
        const allowsProps = turn === 0 && kind !== 'bridge' && kind !== 'cave';
        const boundary: 'open' | 'rail' | 'wall' = kind === 'cliff' ? 'open' : kind === 'bridge' ? 'rail' : 'open';

        const seg: TrackSegment = {
            kind,
            startD: this.cur.d,
            length,
            entry: { x: this.cur.x, y: this.cur.y, z: this.cur.z },
            entryHeading: this.cur.heading,
            exit: { x: 0, y: 0, z: 0 },
            exitHeading: 0,
            halfWidth,
            grade,
            radius,
            turn: turn as 0 | 1 | -1,
            theme: this.theme,
            allowsObstacles,
            allowsProps,
            boundaryLeft: boundary,
            boundaryRight: kind === 'cliff' ? 'rail' : boundary,   // 悬崖：左开右护栏（示意差异化）
        };

        // 计算出口（与 SegmentPath.sample 同一数学）
        if (turn !== 0) {
            const phi = Math.PI / 2;
            const hExit = this.cur.heading + turn * phi;
            const r0x = Math.cos(this.cur.heading), r0z = -Math.sin(this.cur.heading);
            const cx = this.cur.x - r0x * radius * turn;
            const cz = this.cur.z - r0z * radius * turn;
            const rx = Math.cos(hExit), rz = -Math.sin(hExit);
            seg.exit = { x: cx + rx * radius * turn, y: this.cur.y, z: cz + rz * radius * turn };
            seg.exitHeading = normHeading(hExit);
            // 路口记录（弧线中点）
            this.corners.push({ d: seg.startD + length / 2, dir: turn as 1 | -1, passed: false });
        } else {
            const fx = -Math.sin(this.cur.heading), fz = -Math.cos(this.cur.heading);
            seg.exit = {
                x: this.cur.x + fx * length,
                y: this.cur.y + grade * length,
                z: this.cur.z + fz * length,
            };
            seg.exitHeading = normHeading(this.cur.heading);
        }

        // 更新游标与计数（特殊地块生成后重置特殊间隔计数——否则自此以后全图皆特殊）
        this.cur = { x: seg.exit.x, y: seg.exit.y, z: seg.exit.z, heading: seg.exitHeading, d: seg.startD + length };
        const isSpecial = kind === 'bridge' || kind === 'cliff' || kind === 'cave' || kind === 'transition';
        if (turn !== 0) { this.sinceTurnD = 0; this.sinceSpecialD += length; }
        else if (isSpecial) { this.sinceTurnD += length; this.sinceSpecialD = 0; }
        else { this.sinceTurnD += length; this.sinceSpecialD += length; }
        this.lastKind = kind;
        if (kind === 'slopeUp' || kind === 'slopeDown') this.lastSlopeUp = kind === 'slopeUp';
        else this.lastSlopeUp = false;

        this.path.append(seg);
        this.totalGenerated++;
    }
}
