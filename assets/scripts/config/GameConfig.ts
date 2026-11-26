/**
 * 配置加载器（cc 依赖层）：从 assets/resources/game-config.json 读取并校验。
 * 失败时抛错 —— 不允许静默回退。
 */
import { JsonAsset, resources, error } from 'cc';
import { GameConfig, parseConfig } from './GameConfigSchema';
import { ObstacleCatalog, parseCatalog } from './ObstacleCatalog';

const CONFIG_PATH = 'game-config';
const CATALOG_PATH = 'obstacle-catalog';

function loadJson(path: string): Promise<JsonAsset> {
    return new Promise((resolve, reject) => {
        resources.load(path, JsonAsset, (err, asset) => {
            if (err || !asset) reject(new Error(`读取 ${path}.json 失败: ${err?.message ?? '空资源'}`));
            else resolve(asset);
        });
    });
}

export function loadGameConfig(): Promise<GameConfig> {
    return loadJson(CONFIG_PATH).then((asset) => {
        try {
            return parseConfig(asset.json);
        } catch (e) {
            error(String(e));
            throw e instanceof Error ? e : new Error(String(e));
        }
    });
}

export function loadObstacleCatalog(): Promise<ObstacleCatalog> {
    return loadJson(CATALOG_PATH).then((asset) => {
        try {
            return parseCatalog(asset.json);
        } catch (e) {
            error(String(e));
            throw e instanceof Error ? e : new Error(String(e));
        }
    });
}
