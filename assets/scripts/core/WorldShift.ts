/**
 * WorldShift —— 世界原点重定位（长距离浮点精度，纯数学可单测）。
 *
 * 问题：路径绝对坐标随距离无界增长（30 分钟 ≈ 数万逻辑单位 → 世界单位更大），
 * float32 的 GPU 顶点坐标在 ~1e4 后出现可见抖动。
 * 方案：渲染层所有节点按 render = abs − shift 放置；当玩家的渲染坐标超过阈值，
 * 将 shift 吸附到玩家绝对坐标（1.0 网格取整），全场景下一帧自动归位。
 * 相对位置（实体间距、路径形状）不受 shift 影响——只平移坐标系。
 */
export interface Vec3Like { x: number; y: number; z: number; }

export class WorldShift {
    readonly shift: Vec3Like = { x: 0, y: 0, z: 0 };

    /** 渲染坐标 = 绝对坐标 − shift */
    toRender(abs: Vec3Like): Vec3Like {
        return { x: abs.x - this.shift.x, y: abs.y - this.shift.y, z: abs.z - this.shift.z };
    }

    /**
     * 视需要重定位（以玩家绝对坐标为锚）。
     * @returns 是否发生了重定位
     */
    maybeRebase(playerAbs: Vec3Like, threshold = 4000): boolean {
        const rx = playerAbs.x - this.shift.x;
        const rz = playerAbs.z - this.shift.z;
        if (Math.abs(rx) < threshold && Math.abs(rz) < threshold) return false;
        // 玩家绝对坐标按 1.0 取整后作为新原点（整数偏移保证顶点数据可复现）
        this.shift.x += Math.round(playerAbs.x - this.shift.x);
        this.shift.z += Math.round(playerAbs.z - this.shift.z);
        return true;
    }
}
