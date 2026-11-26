/**
 * 模拟广告适配器（测试专用）—— 与正式实现物理隔离于 platform/mock/ 目录。
 * 仅在非微信环境由 AdService 显式注入；正式包（微信环境）永远不会使用本实现发奖。
 * 可注入成功/取消/失败/超时/重复回调，用于测试全部广告状态分支。
 */
import { IInterstitialAdapter, IRewardedAdapter } from '../IPlatform';

export type MockOutcome = 'success' | 'cancel' | 'fail' | 'timeout' | 'duplicate';

export class MockRewardedAdapter implements IRewardedAdapter {
    readonly supported = true;
    outcome: MockOutcome = 'success';
    /** 超时分支：show 永不回调，由 AdService 的超时守护处理 */
    loadCalls = 0;
    showCalls = 0;
    private lastClose: ((isEnded: boolean) => void) | null = null;

    async load(): Promise<boolean> { this.loadCalls++; return true; }

    async show(onClose: (isEnded: boolean) => void): Promise<void> {
        this.showCalls++;
        this.lastClose = onClose;
        switch (this.outcome) {
        case 'success':
            onClose(true);
            break;
        case 'cancel':
            onClose(false);
            break;
        case 'fail':
            throw new Error('模拟广告加载失败');
        case 'timeout':
            break;                              // 不回调 → 由超时守护
        case 'duplicate':
            onClose(true);
            onClose(true);                      // 重复回调：验证幂等结算
        }
    }

    /** 测试手动触发（timeout 分支） */
    fireClose(isEnded: boolean): void { this.lastClose?.(isEnded); }
}

export class MockInterstitialAdapter implements IInterstitialAdapter {
    readonly supported = true;
    loadCalls = 0;
    showCalls = 0;
    failShow = false;
    async load(): Promise<boolean> { this.loadCalls++; return true; }
    async show(): Promise<boolean> { this.showCalls++; return !this.failShow; }
}
