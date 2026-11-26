/**
 * Save —— 本地存档（可注入 storage，测试用内存实现；运行时 cc.sys.localStorage
 * 在微信端自动映射 wx.setStorageSync）。Phase 4：无尽最佳纪录 + 征途通关标记。
 */
export interface Storage {
    get(key: string): string | null;
    set(key: string, value: string): void;
}

export const KEY_BEST_LI = 'zhuri.bestLi';
export const KEY_JOURNEY_DONE = 'zhuri.journeyDone';

export class Save {
    private storage: Storage;

    constructor(storage: Storage) {
        this.storage = storage;
    }

    /** 无尽最佳里程（里）；无记录返回 0 */
    bestLi(): number {
        const raw = this.storage.get(KEY_BEST_LI);
        if (raw === null) return 0;
        const v = Number(raw);
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    }

    /** 仅在更高纪录时写入 */
    setBestLi(li: number): boolean {
        if (!Number.isFinite(li) || li <= 0) return false;
        const v = Math.floor(li);
        if (v <= this.bestLi()) return false;
        this.storage.set(KEY_BEST_LI, String(v));
        return true;
    }

    journeyDone(): boolean {
        return this.storage.get(KEY_JOURNEY_DONE) === '1';
    }

    setJourneyDone(): void {
        this.storage.set(KEY_JOURNEY_DONE, '1');
    }
}
