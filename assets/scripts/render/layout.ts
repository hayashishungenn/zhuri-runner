/**
 * 布局常量：逻辑坐标(450x800, 原点左上) ↔ 设计分辨率(720x1280, Cocos UI 坐标) 映射。
 * 渲染层与输入层共用的唯一换算源。
 */

export const DESIGN_W = 720;
export const DESIGN_H = 1280;
export const LOGICAL_W = 450;
export const LOGICAL_H = 800;
export const S = DESIGN_W / LOGICAL_W;   // 1.6

/** 逻辑坐标 → Cocos UI 坐标（居中原点，y 向上） */
export function LX(gx: number): number { return gx * S - DESIGN_W / 2; }
export function LY(gy: number): number { return DESIGN_H / 2 - gy * S; }

/** Cocos UI 坐标 → 逻辑坐标 */
export function toLogicalX(ux: number): number { return (ux + DESIGN_W / 2) / S; }
export function toLogicalY(uy: number): number { return (DESIGN_H / 2 - uy) / S; }

/** 地平线与玩家基线（逻辑坐标） */
export const HORIZON = 330;
export const PLAYER_Y = 762;
