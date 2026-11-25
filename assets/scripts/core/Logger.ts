/**
 * Logger —— 分级日志（零 cc 依赖，Web/微信运行时通用）。
 * 设计约定：core 层不写日志（抛错/返回错误，保证可测与确定性）；日志由引导/渲染/平台层使用。
 * 微信真机 vConsole 只显示 info 以上；error 级别会进入微信后台 jsError 统计。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let globalLevel: LogLevel = 'debug';

export function setLogLevel(level: LogLevel): void {
    globalLevel = level;
}

export class Logger {
    private tag: string;

    constructor(tag: string) {
        this.tag = tag;
    }

    private enabled(level: LogLevel): boolean {
        return LEVEL_ORDER[level] >= LEVEL_ORDER[globalLevel];
    }

    private fmt(level: LogLevel, msg: string): string {
        return `[${level.toUpperCase()}][${this.tag}] ${msg}`;
    }

    debug(msg: string, ...args: unknown[]) {
        if (this.enabled('debug')) console.debug(this.fmt('debug', msg), ...args);
    }
    info(msg: string, ...args: unknown[]) {
        if (this.enabled('info')) console.info(this.fmt('info', msg), ...args);
    }
    warn(msg: string, ...args: unknown[]) {
        if (this.enabled('warn')) console.warn(this.fmt('warn', msg), ...args);
    }
    error(msg: string, ...args: unknown[]) {
        if (this.enabled('error')) console.error(this.fmt('error', msg), ...args);
    }
}
