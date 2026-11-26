/**
 * Upgrades —— 能力强化（Phase 6）：金币购买，曲线可调，公平性硬约束。
 * 五系强化（速度不在其中——移动速度不受养成影响，保证操作公平）。
 */
export type UpgradeKind = 'staff' | 'water' | 'magnet' | 'heat' | 'gold';

export interface UpgradeDef {
    kind: UpgradeKind;
    label: string;
    desc: (lv: number) => string;
    maxLevel: number;
    costs: number[];
}

export const UPGRADE_DEFS: UpgradeDef[] = [
    { kind: 'staff', label: '神杖强化', desc: (lv) => `桃木神杖层数上限 +${lv}`, maxLevel: 2, costs: [400, 900] },
    { kind: 'water', label: '甘霖强化', desc: (lv) => `甘霖降温 +${lv * 10}`, maxLevel: 2, costs: [350, 800] },
    { kind: 'magnet', label: '引聚强化', desc: (lv) => `灵光引聚时长 +${lv * 3}s`, maxLevel: 2, costs: [300, 700] },
    { kind: 'heat', label: '热适应', desc: (lv) => `升温速率 -${lv * 12}%`, maxLevel: 2, costs: [400, 850] },
    { kind: 'gold', label: '阳炎倍率', desc: (lv) => `金币获得 +${lv * 15}%`, maxLevel: 2, costs: [500, 1100] },
];

export type UpgradeLevels = Partial<Record<UpgradeKind, number>>;

export function levelOf(upgrades: UpgradeLevels, kind: UpgradeKind): number {
    return Math.max(0, Math.min(upgrades[kind] ?? 0, 2));
}

export function totalLevels(upgrades: UpgradeLevels): number {
    return UPGRADE_DEFS.reduce((acc, d) => acc + levelOf(upgrades, d.kind), 0);
}

export class Upgrades {
    levels: UpgradeLevels;

    constructor(levels: UpgradeLevels) {
        this.levels = levels;
    }

    def(kind: UpgradeKind): UpgradeDef {
        return UPGRADE_DEFS.find((d) => d.kind === kind)!;
    }

    level(kind: UpgradeKind): number { return levelOf(this.levels, kind); }

    cost(kind: UpgradeKind): number | null {
        const lv = this.level(kind);
        const def = this.def(kind);
        return lv >= def.maxLevel ? null : def.costs[lv];
    }

    isMaxed(kind: UpgradeKind): boolean { return this.level(kind) >= this.def(kind).maxLevel; }

    /** 购买：金額原子扣减由调用方（Economy.spend）先验证后调用本方法生效 */
    apply(kind: UpgradeKind): boolean {
        if (this.isMaxed(kind)) return false;
        this.levels[kind] = this.level(kind) + 1;
        return true;
    }

    /** 公平性效果换算（核心读取） */
    staffCapBonus(): number { return this.level('staff'); }
    waterReduceBonus(): number { return this.level('water') * 10; }
    magnetDurationBonus(): number { return this.level('magnet') * 3; }
    heatResist(): number { return 1 - this.level('heat') * 0.12; }
    goldMul(): number { return 1 + this.level('gold') * 0.15; }
}
