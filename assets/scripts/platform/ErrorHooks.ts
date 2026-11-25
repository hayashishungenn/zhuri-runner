/**
 * 全局错误钩子：捕获未处理异常/拒绝，接入日志。
 * - 微信运行时：wx.onError / wx.onUnhandledRejection（错误会上报微信后台 jsError）
 * - 浏览器/编辑器预览：window error / unhandledrejection
 */
import { Logger } from '../core/Logger';

const log = new Logger('ErrorHooks');

interface WxErrorApi {
    onError(cb: (err: string) => void): void;
    onUnhandledRejection(cb: (res: { reason: unknown }) => void): void;
}
declare const wx: WxErrorApi | undefined;

export function installGlobalErrorHooks(): void {
    if (typeof wx !== 'undefined') {
        wx.onError((err: string) => log.error('wx.onError:', err));
        wx.onUnhandledRejection((res: { reason: unknown }) => log.error('unhandledRejection:', String(res?.reason)));
        log.info('已安装微信全局错误钩子');
        return;
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('error', (e) => log.error('window.onerror:', e.message, e.filename, e.lineno));
        window.addEventListener('unhandledrejection', (e) => log.error('unhandledRejection:', String(e.reason)));
        log.info('已安装浏览器全局错误钩子');
    }
}
