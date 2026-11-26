/**
 * ConfigRegistry —— 统一配置校验与只读冻结（Phase 8.2.7）。零 cc 依赖。
 *
 * 职责：
 * - 对基础玩法配置、障碍目录、皮肤目录、地块模板执行跨配置一致性校验
 * - 提供 deepFreeze，加载后冻结共享配置对象，彻底杜绝运行期意外改写
 */
import { GameConfig, validateConfig } from './GameConfigSchema';
import { ObstacleCatalog, validateCatalog } from './ObstacleCatalog';
import { SkinCatalog, validateSkins, DEFAULT_SKIN_ID, SKIN_COSTS } from './SkinCatalog';
import { TileTemplateCatalog, validateTileTemplates } from './TileTemplates';

export const CONFIG_SCHEMA_VERSION = '8.2.0';

export interface ConfigBundle {
    game: GameConfig;
    obstacles: ObstacleCatalog;
    skins: SkinCatalog;
    tiles: TileTemplateCatalog;
}

/** 递归冻结配置对象（严格模式下运行期改写将直接抛 TypeError，杜绝静默污染） */
export function deepFreeze<T>(obj: T): Readonly<T> {
    if (obj === null || typeof obj !== 'object') return obj;
    if (!Object.isFrozen(obj)) Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
            deepFreeze(val);
        }
    }
    return obj;
}

/** 跨配置一致性校验（单文件 schema 校验 + 跨文件引用与边界校验） */
export function validateAllConfigs(bundle: ConfigBundle): string[] {
    const errs: string[] = [];

    errs.push(...validateConfig(bundle.game).map((e) => `[game-config] ${e}`));
    errs.push(...validateCatalog(bundle.obstacles).map((e) => `[obstacle-catalog] ${e}`));
    errs.push(...validateSkins(bundle.skins).map((e) => `[skins] ${e}`));
    errs.push(...validateTileTemplates(bundle.tiles).map((e) => `[tile-templates] ${e}`));

    // 1) 皮肤默认项与售价表一致性
    const skinIds = new Set(bundle.skins.skins.map((s) => s.id));
    if (!skinIds.has(DEFAULT_SKIN_ID)) {
        errs.push(`[cross] 默认皮肤 ${DEFAULT_SKIN_ID} 不存在于 skins.json`);
    }
    for (const id of skinIds) {
        const cost = SKIN_COSTS[id];
        if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
            errs.push(`[cross] 皮肤 ${id} 缺失合法售价`);
        }
    }
    if (SKIN_COSTS[DEFAULT_SKIN_ID] !== 0) {
        errs.push(`[cross] 默认皮肤 ${DEFAULT_SKIN_ID} 售价必须为 0`);
    }

    // 2) 地块模板主题索引不得越界
    const themeCount = bundle.game.themes.length;
    for (const tpl of bundle.tiles.templates) {
        if (tpl.theme < 0 || tpl.theme >= themeCount) {
            errs.push(`[cross] 地块模板 ${tpl.id} 的 theme=${tpl.theme} 超出 themes 数量 ${themeCount}`);
        }
    }

    // 3) 地图预生成视野必须覆盖最长障碍模板跨度（spawnZ + maxPatternDz + buffer）
    let maxPatDz = 0;
    for (const pat of bundle.obstacles.patterns) {
        for (const st of pat.steps) {
            if (st.dz > maxPatDz) maxPatDz = st.dz;
        }
    }
    const minHorizon = bundle.game.world.spawnZ + maxPatDz + 16;
    if (bundle.game.map.horizon < minHorizon) {
        errs.push(`[cross] map.horizon (${bundle.game.map.horizon}) 小于安全下限 ${minHorizon}`);
    }

    // 4) 征途阶段里程严格递增
    let prevGoal = 0;
    for (const st of bundle.game.journey.stages) {
        if (st.goalLi <= prevGoal) {
            errs.push(`[cross] journey.stages 里程未严格递增: ${st.label} (${st.goalLi} <= ${prevGoal})`);
        }
        prevGoal = st.goalLi;
    }

    return errs;
}
