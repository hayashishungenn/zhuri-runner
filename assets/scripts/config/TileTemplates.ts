/**
 * 地块模板目录 schema 与校验（Phase 5）。
 * 数据：assets/resources/tile-templates.json —— ≥40 种可复用模板，主题×基型×装饰组合。
 */
export type DecorType = 'pillar' | 'arch' | 'post' | 'banner' | 'tree' | 'rock' | 'lantern' | 'reed' | 'crystal' | 'urn';
export type TemplateKind = 'straight' | 'slopeUp' | 'slopeDown' | 'arcL' | 'arcR' | 'bridge' | 'cliff' | 'cave' | 'transition';

export interface DecorSpec {
    t: DecorType;
    /** 沿地块归一化位置 0-1 */
    d: number;
    /** 横向偏移（世界单位） */
    lane: number;
    s: number;
}
export interface TileTemplate {
    id: string;
    /** 主题索引 0-3（大荒/渭水/荒漠/扶桑） */
    theme: number;
    kind: TemplateKind;
    label: string;
    decor: DecorSpec[];
}
export interface TileTemplateCatalog { templates: TileTemplate[]; }

const DECOR_TYPES: DecorType[] = ['pillar', 'arch', 'post', 'banner', 'tree', 'rock', 'lantern', 'reed', 'crystal', 'urn'];
const KINDS: TemplateKind[] = ['straight', 'slopeUp', 'slopeDown', 'arcL', 'arcR', 'bridge', 'cliff', 'cave', 'transition'];

export function validateTileTemplates(raw: unknown): string[] {
    const errs: string[] = [];
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.templates)) return ['templates 必须为数组'];
    if (obj.templates.length < 40) errs.push(`templates 必须 ≥40 种（任务书要求），实际 ${obj.templates.length}`);
    const ids = new Set<string>();
    for (const rawT of obj.templates as unknown[]) {
        const d = rawT as Record<string, unknown>;
        if (typeof d.id !== 'string' || !d.id) { errs.push('template.id 缺失'); continue; }
        if (ids.has(d.id)) errs.push(`template.id 重复: ${d.id}`);
        ids.add(d.id);
        if (typeof d.theme !== 'number' || d.theme < 0 || d.theme > 3) errs.push(`${d.id}.theme 必须为 0-3`);
        if (!KINDS.includes(d.kind as TemplateKind)) errs.push(`${d.id}.kind 非法: ${d.kind}`);
        if (typeof d.label !== 'string') errs.push(`${d.id}.label 缺失`);
        if (!Array.isArray(d.decor)) errs.push(`${d.id}.decor 必须为数组`);
        else {
            for (const dc of d.decor as unknown[]) {
                const a = dc as Record<string, unknown>;
                if (!DECOR_TYPES.includes(a.t as DecorType)) errs.push(`${d.id}.decor.t 非法: ${a.t}`);
                if (typeof a.d !== 'number' || a.d < 0 || a.d > 1) errs.push(`${d.id}.decor.d 必须在 [0,1]`);
            }
        }
    }
    return errs;
}

export function parseTileTemplates(raw: unknown): TileTemplateCatalog {
    const errs = validateTileTemplates(raw);
    if (errs.length) throw new Error('tile-templates.json 非法：\n  - ' + errs.join('\n  - '));
    return raw as TileTemplateCatalog;
}

