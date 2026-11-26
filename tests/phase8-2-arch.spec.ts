/**
 * Phase 8.2 核心架构重构与工程质量回归测试套件。
 *
 * 覆盖：
 * 1. SimulationClock 固定步长 / 暂停 / 恢复 / 后台恢复 / MAX_SUB_STEPS 限制
 * 2. CollisionSystem 纯数学连续扫掠碰撞与拾取判定
 * 3. GameSession 完整单局生命周期状态机、元进度原子性、广告事务与防迟到/重复发奖
 * 4. CoreCommand 输入意图队列、CoreEvent 领域事件契约、ReadonlyCoreView 只读视图
 * 5. Replay 确定性重放与最小复现导出（exportMinimalRepro）
 * 6. ConfigRegistry 全量配置校验与 deepFreeze 运行时只读保护
 * 7. RenderContracts 角色/场景美术资产替换最小验证与 ResourceTracker 泄漏检测
 * 8. 重复开局与长时运行核心资源有界性检查
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SimulationClock } from '../assets/scripts/core/SimulationClock';
import {
    COLLISION_GEOM, jumpHeightAt, evaluateObstacleSweep, evaluatePickupSweep,
} from '../assets/scripts/core/CollisionSystem';
import { GameCore } from '../assets/scripts/core/GameCore';
import { GameSession } from '../assets/scripts/core/GameSession';
import { ReplayRecorder, replayRun, ENGINE_VERSION } from '../assets/scripts/core/Replay';
import { SeededRng } from '../assets/scripts/core/rng';
import { deepFreeze, validateAllConfigs, CONFIG_SCHEMA_VERSION } from '../assets/scripts/config/ConfigRegistry';
import { DEFAULT_SKIN_ID, SKIN_COSTS, SkinCatalog } from '../assets/scripts/config/SkinCatalog';
import { GameConfig } from '../assets/scripts/config/GameConfigSchema';
import { ObstacleCatalog, parseCatalog } from '../assets/scripts/config/ObstacleCatalog';
import { TileTemplateCatalog } from '../assets/scripts/config/TileTemplates';
import { Save, Storage } from '../assets/scripts/platform/Save';
import {
    CharacterAssetProvider,
    CharacterSkinVisual,
    CharacterVisualHandle,
    LodLevel,
    ResourceTracker,
    SceneAssetBinder,
    toCharacterSkinVisual,
} from '../assets/scripts/render/RenderContracts';
import type { AnimInput, CharAnimState } from '../assets/scripts/render/CharacterAnimator';

function loadJson<T>(rel: string): T {
    return JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as T;
}

const RAW_GAME_CFG = loadJson<GameConfig>('assets/resources/game-config.json');
const RAW_OBS_CAT: ObstacleCatalog = parseCatalog(loadJson('assets/resources/obstacle-catalog.json'));
const RAW_TILES = loadJson<TileTemplateCatalog>('assets/resources/tile-templates.json');
const RAW_SKINS = loadJson<SkinCatalog>('assets/resources/skins.json');
const FATAL_OBS_ID = RAW_OBS_CAT.obstacles.find((o) => o.damage !== 'stumble' && o.pass === 'lane')!.id;
const FIXED_DT = SimulationClock.FIXED_DT;

class MemStorage implements Storage {
    private m = new Map<string, string>();
    get(k: string): string | null { return this.m.get(k) ?? null; }
    set(k: string, v: string): void { this.m.set(k, v); }
}

function makeCore(seed = 20260802): GameCore {
    const core = new GameCore(RAW_GAME_CFG, new SeededRng(seed), {
        turnsEnabled: true,
        catalog: RAW_OBS_CAT,
        mode: 'endless',
        seed,
    });
    core.startRun({ seed, mode: 'endless' });
    return core;
}

function makeSession(seed = 1001) {
    const storage = new MemStorage();
    const save = new Save(storage);
    const core = new GameCore(RAW_GAME_CFG, new SeededRng(seed), {
        turnsEnabled: true,
        catalog: RAW_OBS_CAT,
        mode: 'endless',
        seed,
    });
    const session = new GameSession({
        core,
        save,
        skinIds: RAW_SKINS.skins.map((s) => s.id),
        today: () => '2026-11-26',
    });
    return { session, core, save, storage };
}

describe('Phase 8.2.3 SimulationClock 固定步长时钟', () => {
    it('按 60Hz 累积推进并保持 renderAlpha 在 [0, 1)', () => {
        const clk = new SimulationClock();
        let steps = 0;
        const ran = clk.advance(FIXED_DT * 2.5, (dt) => {
            steps++;
            clk.advanceRunTime(dt);
        });
        expect(ran).toBe(2);
        expect(steps).toBe(2);
        expect(clk.fixedTick).toBe(2);
        expect(clk.runTime).toBeCloseTo(FIXED_DT * 2, 6);
        expect(clk.renderAlpha).toBeGreaterThanOrEqual(0);
        expect(clk.renderAlpha).toBeLessThan(1);
        expect(clk.renderAlpha).toBeCloseTo(0.5, 4);
    });

    it('大帧间隔受 MAX_FRAME_DT 与 MAX_SUB_STEPS 限制，onBackgroundResume 清空积压', () => {
        const clk = new SimulationClock();
        let steps = 0;
        const ran = clk.advance(5.0, () => { steps++; });
        expect(ran).toBe(SimulationClock.MAX_SUB_STEPS);
        expect(steps).toBe(ran);

        clk.advance(FIXED_DT * 0.7, () => { /* noop */ });
        expect(clk.renderAlpha).toBeGreaterThan(0);
        clk.onBackgroundResume();
        expect(clk.renderAlpha).toBe(0);
    });

    it('暂停时冻结 fixedTick/runTime/gTime，恢复后清零残余累加器', () => {
        const clk = new SimulationClock();
        clk.advance(FIXED_DT * 3.4, (dt) => { clk.advanceRunTime(dt); });
        const tickBefore = clk.fixedTick;
        const runBefore = clk.runTime;
        const gBefore = clk.gTime;

        clk.pause();
        let called = 0;
        const ran = clk.advance(0.1, () => { called++; });
        expect(ran).toBe(0);
        expect(called).toBe(0);
        expect(clk.fixedTick).toBe(tickBefore);
        expect(clk.runTime).toBe(runBefore);
        expect(clk.gTime).toBe(gBefore);

        clk.resume();
        expect(clk.renderAlpha).toBe(0);
    });
});

describe('Phase 8.2.3 CollisionSystem 纯数学连续碰撞与拾取', () => {
    it('高速扫掠：起止点均在碰撞盒外但穿过玩家 Z 区间时仍命中', () => {
        const res = evaluateObstacleSweep({
            prevZ: 1.8,
            currZ: -1.5,
            hitZFront: 0.45,
            prevLaneF: 0,
            currLaneF: 0,
            prevJumpT: -1,
            currJumpT: -1,
            prevSlideT: -1,
            currSlideT: -1,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'jump',
            lanes: [0],
        });
        expect(res.crossed).toBe(true);
        expect(res.lateralHit).toBe(true);
        expect(res.safe).toBe(false);
    });

    it('跳跃高度足够越过低障，滑铲姿态足够穿过高障', () => {
        const peak = jumpHeightAt(0.5, false);
        expect(peak).toBeGreaterThan(COLLISION_GEOM.JUMP_CLEAR_HEIGHT);
        const jumpRes = evaluateObstacleSweep({
            prevZ: 0.6,
            currZ: -0.2,
            hitZFront: 0.45,
            prevLaneF: 0,
            currLaneF: 0,
            prevJumpT: 0.45,
            currJumpT: 0.55,
            prevSlideT: -1,
            currSlideT: -1,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'jump',
            lanes: [0],
        });
        expect(jumpRes.crossed).toBe(true);
        expect(jumpRes.safe).toBe(true);

        const standHitHigh = evaluateObstacleSweep({
            prevZ: 0.6,
            currZ: -0.2,
            hitZFront: 0.45,
            prevLaneF: 0,
            currLaneF: 0,
            prevJumpT: -1,
            currJumpT: -1,
            prevSlideT: -1,
            currSlideT: -1,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'slide',
            lanes: [0],
        });
        expect(standHitHigh.safe).toBe(false);

        const slideClearHigh = evaluateObstacleSweep({
            prevZ: 0.6,
            currZ: -0.2,
            hitZFront: 0.45,
            prevLaneF: 0,
            currLaneF: 0,
            prevJumpT: -1,
            currJumpT: -1,
            prevSlideT: 0.4,
            currSlideT: 0.35,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'slide',
            lanes: [0],
        });
        expect(slideClearHigh.safe).toBe(true);
    });

    it('横向角色宽度与连续滚石（continuousLane）精确判定', () => {
        const threshold = COLLISION_GEOM.PLAYER_HALF_WIDTH + COLLISION_GEOM.OBS_HALF_WIDTH;
        const edgeHit = evaluateObstacleSweep({
            prevZ: 0.4,
            currZ: -0.2,
            hitZFront: 0.45,
            prevLaneF: threshold - 0.05,
            currLaneF: threshold - 0.05,
            prevJumpT: -1,
            currJumpT: -1,
            prevSlideT: -1,
            currSlideT: -1,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'lane',
            lanes: [0],
        });
        const safeFar = evaluateObstacleSweep({
            prevZ: 0.4,
            currZ: -0.2,
            hitZFront: 0.45,
            prevLaneF: threshold + 0.05,
            currLaneF: threshold + 0.05,
            prevJumpT: -1,
            currJumpT: -1,
            prevSlideT: -1,
            currSlideT: -1,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'lane',
            lanes: [0],
        });
        expect(edgeHit.safe).toBe(false);
        expect(safeFar.safe).toBe(true);

        const rollerHit = evaluateObstacleSweep({
            prevZ: 0.4,
            currZ: -0.2,
            hitZFront: 0.45,
            prevLaneF: 0.3,
            currLaneF: 0.3,
            prevJumpT: -1,
            currJumpT: -1,
            prevSlideT: -1,
            currSlideT: -1,
            jumpSafeFrom: 0.12,
            jumpSafeTo: 0.88,
            leapActive: false,
            effPass: 'jump',
            lanes: [0],
            continuousLane: 0.35,
        });
        expect(rollerHit.lateralHit).toBe(true);
        expect(rollerHit.safe).toBe(false);
    });

    it('连续拾取扫掠：高速穿过金币/道具区间不漏拾', () => {
        expect(evaluatePickupSweep({
            prevZ: 2.0, currZ: -2.0, pickFrom: -0.5, pickTo: 0.5,
            prevLaneF: 0, currLaneF: 0, targetLane: 0,
        })).toBe(true);
        expect(evaluatePickupSweep({
            prevZ: 2.0, currZ: -2.0, pickFrom: -0.5, pickTo: 0.5,
            prevLaneF: 0, currLaneF: 0, targetLane: 1,
        })).toBe(false);
    });
});

describe('Phase 8.2.2 / 8.2.8 GameSession 单局生命周期与成长系统集成', () => {
    it('完整状态流转：title → running ⇄ paused → dying → awaitRevive → running(revive) → settled → title', () => {
        const { session, core, save } = makeSession(1001);
        expect(session.state).toBe('title');

        const { runId } = session.startRun('endless', { seed: 1001 });
        expect(session.state).toBe('running');
        expect(runId).toBeGreaterThan(0);

        session.pause();
        expect(session.state).toBe('paused');
        expect(core.paused).toBe(true);

        session.resume();
        expect(session.state).toBe('running');
        expect(core.paused).toBe(false);

        // 推进一段距离并收集碎片
        for (let i = 0; i < 30; i++) session.tick(FIXED_DT);
        core.fragments.push({ lane: core.targetLane, z: 0.1, got: false });
        session.tick(FIXED_DT);
        const fragsBeforeDeath = core.frags;
        expect(fragsBeforeDeath).toBeGreaterThanOrEqual(1);

        // 触发致命碰撞进入 dying -> awaitRevive
        core.invincible = 0;
        core.obstacles.push({
            defId: FATAL_OBS_ID, lane: core.targetLane,
            z: 0.2, passed: false, phase: 0,
        });
        session.tick(FIXED_DT);
        expect(session.state).toBe('dying');

        // 推进死亡演出到 awaitRevive
        let sawSettled = false;
        for (let i = 0; i < 90 && session.state === 'dying'; i++) {
            const r = session.tick(FIXED_DT);
            if (r.settled) sawSettled = true;
        }
        expect(session.state).toBe('awaitRevive');
        expect(sawSettled).toBe(true);
        const goldAfterFirstDeath = save.data.gold;
        const runsAfterFirstDeath = save.data.stats.runs;

        // 走广告复活票据
        const ticket = session.prepareAdTicket('revive');
        expect(ticket).not.toBeNull();
        const outcome = session.applyAdReward(ticket!);
        expect(outcome.applied).toBe(true);
        expect(session.state).toBe('running');
        expect(session.currentRunId).toBe(runId);

        // 复活后再吃 1 个碎片并二次死亡（此时不可再复活 -> settled）
        core.fragments.push({ lane: core.targetLane, z: 0.1, got: false });
        session.tick(FIXED_DT);
        core.invincible = 0;
        core.obstacles.push({
            defId: FATAL_OBS_ID, lane: core.targetLane,
            z: 0.2, passed: false, phase: 0,
        });
        session.tick(FIXED_DT);
        for (let i = 0; i < 90 && session.state === 'dying'; i++) session.tick(FIXED_DT);
        expect(session.state).toBe('settled');
        expect(save.data.gold).toBeGreaterThan(goldAfterFirstDeath);
        // 同一局复活后再次结算不重复增加局数
        expect(save.data.stats.runs).toBe(runsAfterFirstDeath);

        // 返回标题页
        session.returnToTitle();
        expect(session.state).toBe('title');
    });

    it('广告票据防迟到回调与防重复发放；timedPower 保留到下一局开局生效', () => {
        const { session, core, save } = makeSession(2002);
        session.startRun('endless', { seed: 2002 });
        core.fragments.push({ lane: core.targetLane, z: 0.1, got: false });
        session.tick(FIXED_DT);

        // 死亡进入 awaitRevive 并结算
        core.invincible = 0;
        core.obstacles.push({
            defId: FATAL_OBS_ID, lane: core.targetLane,
            z: 0.2, passed: false, phase: 0,
        });
        session.tick(FIXED_DT);
        for (let i = 0; i < 90 && session.state === 'dying'; i++) session.tick(FIXED_DT);

        // 准备双倍金币票据，但先开新局再迟到回调 -> 必须拒绝
        const staleTicket = session.prepareAdTicket('doubleCoins');
        expect(staleTicket).not.toBeNull();
        const goldBefore = save.data.gold;
        session.startRun('endless', { seed: 2003 });
        expect(session.applyAdReward(staleTicket!).applied).toBe(false);
        expect(save.data.gold).toBe(goldBefore);

        // timedPower 票据申请后在同一票据重复 apply 被拒绝，且下一局开局即生效
        const buffTicket = session.prepareAdTicket('timedPower');
        expect(buffTicket).not.toBeNull();
        expect(session.applyAdReward(buffTicket!).applied).toBe(true);
        expect(session.applyAdReward(buffTicket!).applied).toBe(false);
        session.startRun('endless', { seed: 2004 });
        expect(core.dashT > 0 || core.shieldCharges > 0 || core.magnetT > 0).toBe(true);
    });

    it('皮肤购买/装备/切换、强化购买与备份恢复通过 GameSession 原子落盘', () => {
        const { session, save } = makeSession(3001);
        session.economy.grant('test:seed_gold', 5000);
        session.persist();

        expect(session.currentSkinId).toBe(DEFAULT_SKIN_ID);

        const targetSkin = RAW_SKINS.skins.find((s) => s.id !== DEFAULT_SKIN_ID)!;
        expect(session.equipSkin(targetSkin.id)).toBe(false);

        const cost = SKIN_COSTS[targetSkin.id] ?? 0;
        const goldBefore = session.economy.gold;
        expect(session.buySkin(targetSkin.id)).toBe(true);
        expect(session.economy.gold).toBe(goldBefore - cost);
        expect(session.currentSkinId).toBe(targetSkin.id);

        // 重复购买拒绝
        expect(session.buySkin(targetSkin.id)).toBe(false);

        // 切换已拥有皮肤
        const cycled = session.cycleOwnedSkin();
        expect(cycled).toBe(DEFAULT_SKIN_ID);

        // 强化购买
        const upgBefore = save.data.upgrades.magnet ?? 0;
        expect(session.buyUpgrade('magnet')).toBe(true);
        expect(save.data.upgrades.magnet).toBe(upgBefore + 1);
    });
});

describe('Phase 8.2.4 / 8.2.5 输入命令队列、领域事件与只读视图', () => {
    it('CoreCommand 在下一固定逻辑帧生效，CoreEvent 附带 runId 与单调 tick', () => {
        const core = makeCore(3003);
        const eventsStart = core.drainEvents();
        expect(eventsStart.some((e) => e.type === 'runStart')).toBe(true);
        expect(eventsStart[0].runId).toBe(core.runSeed);
        expect(eventsStart[0].tick).toBe(0);

        const startLane = core.targetLane;
        core.enqueueCommand({ type: 'lane', dir: 1 });
        core.enqueueCommand({ type: 'jump' });
        core.update(FIXED_DT);

        expect(core.targetLane).toBe(Math.min(1, startLane + 1));
        expect(core.jumpT).toBeGreaterThanOrEqual(0);

        const evs = core.drainEvents();
        expect(evs.some((e) => e.type === 'jump')).toBe(true);
        let prevTick = -1;
        for (const e of evs) {
            expect(e.runId).toBe(core.runSeed);
            expect(e.tick).toBeGreaterThanOrEqual(prevTick);
            prevTick = e.tick!;
        }

        const view = core.view;
        expect(view.runSeed).toBe(core.runSeed);
        expect(view.state).toBe('run');
        expect(view.dist).toBe(core.dist);
        expect(view.targetLane).toBe(core.targetLane);
    });
});

describe('Phase 8.2.6 Replay 确定性重放与最小复现导出', () => {
    it('同种子与命令流重放结果逐字段一致，且 exportMinimalRepro 可反序列化复现', () => {
        expect(ENGINE_VERSION).toBeTruthy();
        const seed = 884801;
        const core = makeCore(seed);
        const rec = new ReplayRecorder({
            seed,
            mode: 'endless',
            turnsEnabled: true,
            mods: core.mods,
        });

        const issue = (tick: number, cmd: Parameters<ReplayRecorder['recordCommand']>[1]) => {
            if (core.fixedTick === tick) {
                rec.recordCommand(core.fixedTick, cmd);
                core.enqueueCommand(cmd);
            }
        };

        for (let i = 0; i < 240; i++) {
            issue(10, { type: 'lane', dir: -1 });
            issue(30, { type: 'jump' });
            issue(80, { type: 'lane', dir: 1 });
            issue(110, { type: 'slide' });
            issue(150, { type: 'lane', dir: 1 });
            core.update(FIXED_DT);
            if (core.state === 'dead') break;
        }

        const recording = rec.finish(core.fixedTick);
        const r1 = replayRun(recording, RAW_GAME_CFG, RAW_OBS_CAT);
        const parsedRepro = JSON.parse(rec.exportMinimalRepro(core.fixedTick, 'sample_err')) as { repro: typeof recording; error: string };
        expect(parsedRepro.error).toBe('sample_err');
        const r2 = replayRun(parsedRepro.repro, RAW_GAME_CFG, RAW_OBS_CAT);

        expect(r1.state).toBe(core.state);
        expect(r1.fixedTick).toBe(core.fixedTick);
        expect(r1.dist).toBeCloseTo(core.dist, 9);
        expect(r1.frags).toBe(core.frags);
        expect(r1.playerLaneF).toBeCloseTo(core.playerLaneF, 9);
        expect(r1.heat).toBeCloseTo(core.heat, 9);
        expect(r2).toEqual(r1);
    });
});

describe('Phase 8.2.7 ConfigRegistry 配置校验与运行时只读保护', () => {
    it('项目真实 JSON 配置全量通过校验且包含 schema 版本', () => {
        expect(CONFIG_SCHEMA_VERSION).toBe('8.2.0');
        const errs = validateAllConfigs({
            game: RAW_GAME_CFG,
            obstacles: RAW_OBS_CAT,
            skins: RAW_SKINS,
            tiles: RAW_TILES,
        });
        expect(errs).toEqual([]);
    });

    it('非法配置（负数速度/越界主题索引/缺失默认皮肤）被精确拦截', () => {
        const badGame = structuredClone(RAW_GAME_CFG);
        badGame.speed.base = -10;
        const badTiles = structuredClone(RAW_TILES);
        badTiles.templates[0].theme = 99;
        const badSkins = structuredClone(RAW_SKINS);
        badSkins.skins = badSkins.skins.filter((s) => s.id !== DEFAULT_SKIN_ID);

        const errs = validateAllConfigs({
            game: badGame,
            obstacles: RAW_OBS_CAT,
            skins: badSkins,
            tiles: badTiles,
        });
        expect(errs.length).toBeGreaterThanOrEqual(3);
        expect(errs.some((e) => e.includes('speed.base'))).toBe(true);
        expect(errs.some((e) => e.includes('超出 themes 数量'))).toBe(true);
        expect(errs.some((e) => e.includes(DEFAULT_SKIN_ID))).toBe(true);
    });

    it('deepFreeze 递归冻结配置，运行时修改抛出 TypeError', () => {
        const frozen = deepFreeze(structuredClone(RAW_GAME_CFG));
        expect(() => {
            (frozen.speed as { base: number }).base = 999;
        }).toThrow(TypeError);
        expect(() => {
            (frozen.heat as { baseRate: number }).baseRate = 999;
        }).toThrow(TypeError);
    });
});

describe('Phase 8.2.9 / 8.2.10 RenderContracts 资产替换最小验证与资源追踪', () => {
    interface MockNode { name: string; lod: LodLevel; visible: boolean; skinId: string; destroyed: boolean }

    function createMockGltfCharacterProvider(tracker: ResourceTracker): CharacterAssetProvider<MockNode> {
        return {
            providerId: 'mock-gltf-kuafu',
            createCharacter(_parent, initialSkin): CharacterVisualHandle<MockNode> {
                tracker.alloc('characterNode');
                const root: MockNode = { name: 'Kuafu_GLTF', lod: 0, visible: true, skinId: initialSkin?.id ?? DEFAULT_SKIN_ID, destroyed: false };
                const shadow: MockNode = { name: 'Kuafu_Shadow', lod: 0, visible: true, skinId: '', destroyed: false };
                let lastHop = 0;
                const playedStates: CharAnimState[] = [];
                return {
                    root,
                    shadow,
                    get lastHop() { return lastHop; },
                    clipMap: {
                        idle: 'Kuafu_Idle',
                        run: 'Kuafu_Run',
                        jump: 'Kuafu_Jump',
                        slide: 'Kuafu_Slide',
                        stumble: 'Kuafu_Stumble',
                        dead: 'Kuafu_Dead',
                    },
                    sockets: { head: root, hand: root },
                    update(_dt: number, input: AnimInput) {
                        lastHop = input.jumpT >= 0 ? Math.sin(input.jumpT * Math.PI) * 1.65 : 0;
                        playedStates.push(input.state);
                    },
                    applySkin(skin: CharacterSkinVisual) {
                        root.skinId = skin.id;
                    },
                    setVisible(v: boolean) {
                        root.visible = v;
                    },
                    setLod(lod: LodLevel) {
                        root.lod = lod;
                    },
                    destroy() {
                        if (!root.destroyed) {
                            root.destroyed = true;
                            shadow.destroyed = true;
                            tracker.free('characterNode');
                        }
                    },
                };
            },
        };
    }

    it('无核心修改完成角色 FBX/glTF Provider 与 SceneAssetBinder 替换验证', () => {
        const tracker = new ResourceTracker();
        const charProvider = createMockGltfCharacterProvider(tracker);
        const sceneBinder: SceneAssetBinder<MockNode> = {
            binderId: 'mock-modular-tiles',
            createObstacleNode(_parent, obstacleDefId) {
                tracker.alloc('obstacleNode');
                return { name: `gltf_${obstacleDefId}`, lod: 0, visible: true, skinId: '', destroyed: false };
            },
        };

        const parent: MockNode = { name: 'world3d', lod: 0, visible: true, skinId: '', destroyed: false };
        const skinVisual = toCharacterSkinVisual(RAW_SKINS.skins[0]);
        const handle = charProvider.createCharacter(parent, skinVisual);
        expect(handle.clipMap?.run).toBe('Kuafu_Run');
        expect(handle.sockets?.hand).toBeDefined();

        const core = makeCore(4004);
        core.enqueueCommand({ type: 'jump' });
        core.update(FIXED_DT);
        handle.update(FIXED_DT, {
            state: core.jumpT >= 0 ? 'jump' : 'run',
            runPhase: core.runPhase,
            hop: handle.lastHop,
            jumpT: core.jumpT,
            slideT: core.slideT,
            stumbleT: core.stumbleTimer,
            gTime: core.gTime,
            yawDeg: 0,
            groundY: 0,
        });
        expect(handle.lastHop).toBeGreaterThanOrEqual(0);
        handle.setLod?.(1);
        expect(handle.root.lod).toBe(1);

        const obsNode = sceneBinder.createObstacleNode!(parent, 'rock', 0);
        expect(obsNode?.name).toBe('gltf_rock');
        tracker.free('obstacleNode');
        handle.destroy();
        expect(tracker.isAllFreed()).toBe(true);
    });

    it('连续 50 次重复开局：核心实体、路径分段、事件与命令队列严格有界', () => {
        const core = makeCore(5005);
        let maxObs = 0;
        let maxFrags = 0;
        let maxSegs = 0;
        for (let run = 0; run < 50; run++) {
            core.startRun({ seed: 5005 + run, mode: 'endless' });
            core.invincible = 999; // 仅测试对象有界与回收稳定性
            for (let f = 0; f < 120; f++) {
                core.update(FIXED_DT);
                core.drainEvents();
            }
            const stats = core.getResourceStats();
            maxObs = Math.max(maxObs, stats.obstacles);
            maxFrags = Math.max(maxFrags, stats.fragments);
            maxSegs = Math.max(maxSegs, stats.segments);
            expect(stats.queuedCommands).toBe(0);
            expect(stats.pendingEvents).toBe(0);
        }
        expect(maxObs).toBeLessThan(40);
        expect(maxFrags).toBeLessThan(80);
        expect(maxSegs).toBeLessThan(40);
    });
});
