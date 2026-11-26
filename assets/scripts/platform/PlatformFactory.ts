/** 平台工厂：按运行时选择实现（零 cc 依赖，可被单测直接调用） */
import { IPlatform } from './IPlatform';
import { BrowserPlatform } from './BrowserPlatform';
import { WxPlatform } from './WxPlatform';

/** 检测微信小游戏运行时（wx 存在且非浏览器 window 环境） */
export function detectWechat(): boolean {
    return typeof globalThis !== 'undefined' && typeof (globalThis as { wx?: unknown }).wx === 'object';
}

export function createPlatform(): IPlatform {
    return detectWechat() ? new WxPlatform() : new BrowserPlatform();
}
