/**
 * Achievements —— 长期成就（Phase 6）：60 项，覆盖距离/金币/障碍/神通/地图/挑战通关。
 * 一次性解锁 + 幂等领取；零 cc 依赖。
 */
import { StatsSaveState } from '../platform/Save';

export type AchMetric =
    | 'totalLi' | 'totalFrags' | 'runs' | 'turns' | 'obstaclesPassed' | 'obstaclesSmashed'
    | 'useDash' | 'useMagnet' | 'useLeap' | 'useShield' | 'useWater' | 'useStaff'
    | 'themes' | 'journeys' | 'goldEarned' | 'coolRuns' | 'waterDrunk' | 'skins' | 'upgradeLevels' | 'bestLi';

export interface AchievementDef {
    id: string;
    label: string;
    metric: AchMetric;
    goal: number;
    reward: number;
}

function tiered(prefix: string, label: (n: number) => string, metric: AchMetric, tiers: number[], reward: number): AchievementDef[] {
    return tiers.map((goal, i) => ({
        id: `${prefix}_${i + 1}`, label: label(goal), metric, goal,
        reward: reward * (i + 1),
    }));
}

/** 60 项长期成就 */
export const ACHIEVEMENTS: AchievementDef[] = [
    ...tiered('dist', (n) => `累计奔行 ${n} 里`, 'totalLi', [1000, 5000, 10000, 50000, 100000, 500000], 80),
    ...tiered('frag', (n) => `累计拾取 ${n} 枚阳炎`, 'totalFrags', [100, 500, 1000, 5000, 10000, 50000], 80),
    ...tiered('runs', (n) => `完成 ${n} 局奔跑`, 'runs', [10, 50, 100, 500, 1000], 70),
    ...tiered('turn', (n) => `通过 ${n} 处路口`, 'turns', [10, 50, 100, 500, 1000], 80),
    ...tiered('pass', (n) => `越过 ${n} 个障碍`, 'obstaclesPassed', [100, 500, 1000, 5000, 10000], 80),
    ...tiered('smash', (n) => `击碎 ${n} 个障碍`, 'obstaclesSmashed', [10, 50, 100, 500], 90),
    ...tiered('dash', (n) => `使用御风疾行 ${n} 次`, 'useDash', [5, 25], 80),
    ...tiered('magnet', (n) => `使用灵光引聚 ${n} 次`, 'useMagnet', [5, 25], 80),
    ...tiered('leap', (n) => `使用巨人之跃 ${n} 次`, 'useLeap', [5, 25], 80),
    ...tiered('shield', (n) => `使用山岳护体 ${n} 次`, 'useShield', [3, 15], 80),
    ...tiered('waterA', (n) => `使用甘霖降临 ${n} 次`, 'useWater', [5, 25], 80),
    ...tiered('staffA', (n) => `使用桃木神杖 ${n} 次`, 'useStaff', [5, 25], 80),
    { id: 'themes_all', label: '踏足全部四境', metric: 'themes', goal: 4, reward: 300 },
    ...tiered('journey', (n) => `完成 ${n} 次逐日征途`, 'journeys', [1, 3], 300),
    ...tiered('gold', (n) => `累计获得 ${n} 灵光金币`, 'goldEarned', [500, 2000, 10000, 50000], 90),
    { id: 'cool_run', label: '清凉奔行：一局全程未过热', metric: 'coolRuns', goal: 1, reward: 150 },
    ...tiered('drink', (n) => `饮用 ${n} 次甘霖`, 'waterDrunk', [10, 50], 90),
    ...tiered('skinsA', (n) => `收集 ${n} 套皮肤`, 'skins', [4, 8], 200),
    ...tiered('upg', (n) => `强化总等级达到 ${n}`, 'upgradeLevels', [3, 6], 150),
    ...tiered('best', (n) => `最佳里程达到 ${n} 里`, 'bestLi', [1000, 3000, 6000], 120),
];

function achievedValue(stats: StatsSaveState, extra: { skins: number; upgradeLevels: number }, m: AchMetric): number {
    switch (m) {
    case 'totalLi': return Math.floor(stats.totalLi);
    case 'totalFrags': return stats.totalFrags;
    case 'runs': return stats.runs;
    case 'turns': return stats.turns;
    case 'obstaclesPassed': return stats.obstaclesPassed;
    case 'obstaclesSmashed': return stats.obstaclesSmashed;
    case 'useDash': return stats.itemUses.dash ?? 0;
    case 'useMagnet': return stats.itemUses.magnet ?? 0;
    case 'useLeap': return stats.itemUses.leap ?? 0;
    case 'useShield': return stats.itemUses.shield ?? 0;
    case 'useWater': return stats.itemUses.water ?? 0;
    case 'useStaff': return stats.itemUses.staff ?? 0;
    case 'themes': return stats.themeVisited.length;
    case 'journeys': return stats.coolRuns >= 0 && stats.themeVisited.length >= 4 ? (stats.itemUses.journey ?? 0) : 0;
    case 'goldEarned': return stats.goldEarned;
    case 'coolRuns': return stats.coolRuns;
    case 'waterDrunk': return stats.waterDrunk;
    case 'skins': return extra.skins;
    case 'upgradeLevels': return extra.upgradeLevels;
    case 'bestLi': return stats.bestRunLi;
    }
}

export interface AchState { claimed: string[]; }

export class Achievements {
    private defs = ACHIEVEMENTS;

    /** 是否已达成（数值达标即解锁，领取与解锁分离） */
    isUnlocked(def: AchievementDef, stats: StatsSaveState, extra: { skins: number; upgradeLevels: number }): boolean {
        return achievedValue(stats, extra, def.metric) >= def.goal;
    }

    valueOf(def: AchievementDef, stats: StatsSaveState, extra: { skins: number; upgradeLevels: number }): number {
        return Math.min(achievedValue(stats, extra, def.metric), def.goal);
    }

    unlockedList(stats: StatsSaveState, extra: { skins: number; upgradeLevels: number }): AchievementDef[] {
        return this.defs.filter((d) => this.isUnlocked(d, stats, extra));
    }

    isClaimed(def: AchievementDef, claimed: string[]): boolean {
        return claimed.includes(def.id);
    }

    /** 幂等领取：已领取返回 0 */
    claim(def: AchievementDef, claimed: string[]): boolean {
        if (claimed.includes(def.id)) return false;
        claimed.push(def.id);
        return true;
    }
}
