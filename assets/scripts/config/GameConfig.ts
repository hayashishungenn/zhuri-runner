/**
 * 配置加载器（cc 依赖层）：从 assets/resources/game-config.json 读取并校验。
 * 失败时抛错 —— 不允许静默回退。
 */
import { JsonAsset, resources, error } from 'cc';
import { GameConfig, parseConfig } from './GameConfigSchema';

const CONFIG_PATH = 'game-config';

export function loadGameConfig(): Promise<GameConfig> {
    return new Promise((resolve, reject) => {
        resources.load(CONFIG_PATH, JsonAsset, (err, asset) => {
            if (err || !asset) {
                reject(new Error(`读取 ${CONFIG_PATH}.json 失败: ${err?.message ?? '空资源'}`));
                return;
            }
            try {
                resolve(parseConfig(asset.json));
            } catch (e) {
                error(String(e));
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    });
}
