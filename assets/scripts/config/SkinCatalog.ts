/**
 * 皮肤目录 schema 与校验（Phase 5）。
 * 数据：assets/resources/skins.json —— 8 套 = 材质着色 + 几何配件组合（任务书：不得仅修改名称）。
 */
export interface SkinAccessory {
    shape: 'sphere' | 'cone' | 'box' | 'cyl';
    pos: [number, number, number];
    scale: [number, number, number];
    tint: [number, number, number];
}
export interface SkinDef {
    id: string;
    label: string;
    bodyTint: [number, number, number];
    staffTint: [number, number, number];
    accessories: SkinAccessory[];
}
export interface SkinCatalog { skins: SkinDef[]; }

const SHAPES = ['sphere', 'cone', 'box', 'cyl'];

export function validateSkins(raw: unknown): string[] {
    const errs: string[] = [];
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.skins)) return ['skins 必须为数组'];
    if (obj.skins.length < 8) errs.push(`skins 必须 ≥8 套，实际 ${obj.skins.length}`);
    const ids = new Set<string>();
    for (const rawSkin of obj.skins as unknown[]) {
        const d = rawSkin as Record<string, unknown>;
        if (typeof d.id !== 'string' || !d.id) { errs.push('skin.id 缺失'); continue; }
        if (ids.has(d.id)) errs.push(`skin.id 重复: ${d.id}`);
        ids.add(d.id);
        if (typeof d.label !== 'string') errs.push(`${d.id}.label 缺失`);
        for (const tk of ['bodyTint', 'staffTint'] as const) {
            if (!Array.isArray(d[tk]) || (d[tk] as unknown[]).length !== 3) errs.push(`${d.id}.${tk} 必须为 [r,g,b]`);
        }
        if (!Array.isArray(d.accessories)) errs.push(`${d.id}.accessories 必须为数组`);
        else {
            for (const a of d.accessories as unknown[]) {
                const ac = a as Record<string, unknown>;
                if (!SHAPES.includes(ac.shape as string)) errs.push(`${d.id}.accessory.shape 非法: ${ac.shape}`);
                if (!Array.isArray(ac.pos) || (ac.pos as unknown[]).length !== 3) errs.push(`${d.id}.accessory.pos 必须 3 维`);
                if (!Array.isArray(ac.scale) || (ac.scale as unknown[]).length !== 3) errs.push(`${d.id}.accessory.scale 必须 3 维`);
            }
        }
    }
    return errs;
}

export function parseSkins(raw: unknown): SkinCatalog {
    const errs = validateSkins(raw);
    if (errs.length) throw new Error('skins.json 非法：\n  - ' + errs.join('\n  - '));
    return raw as SkinCatalog;
}

