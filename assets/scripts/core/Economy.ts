/**
 * Economy —— 灵光金币经济（Phase 6）。
 * 统一奖励事务接口：幂等 id 防重复领取；spend 原子扣减防异常重复扣除。
 * 不提供真实货币购买/兑换/提现。
 */
export class Economy {
    gold = 0;
    private txLog: Set<string>;
    private txOrder: string[] = [];
    private maxLog = 512;
    /** 累计获得（成就统计用） */
    goldEarned = 0;

    constructor(gold = 0, txLog?: string[]) {
        this.gold = Math.max(0, Math.floor(gold));
        this.txLog = new Set(txLog ?? []);
        this.txOrder = txLog ?? [];
    }

    exportTxLog(): string[] { return [...this.txOrder]; }

    /**
     * 奖励发放（幂等）：同一 txId 只发放一次。
     * @returns 实际发放金额（重复领取返回 0）
     */
    grant(txId: string, amount: number): number {
        if (amount <= 0) return 0;
        if (this.txLog.has(txId)) return 0;
        this.txLog.add(txId);
        this.txOrder.push(txId);
        if (this.txOrder.length > this.maxLog) this.txOrder.shift();
        const amt = Math.floor(amount);
        this.gold += amt;
        this.goldEarned += amt;
        return amt;
    }

    /** 消费：余额不足返回 false（原子，不产生负数） */
    spend(amount: number): boolean {
        const amt = Math.floor(amount);
        if (amt <= 0 || this.gold < amt) return false;
        this.gold -= amt;
        return true;
    }
}
