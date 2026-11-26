/**
 * Replay —— 轻量级确定性回放与缺陷最小复现导出（Phase 8.2.6）。零 cc 依赖。
 *
 * 仅用于开发、测试与缺陷复现（不含联网录像/排行榜）。
 * 依赖 Phase 8.1/8.2 的 60Hz 固定步长与主种子 4 条独立随机流：
 * 同版本、同配置、同种子及同逻辑帧输入序列 → 逐帧位等价重现。
 */
import { GameConfig } from '../config/GameConfigSchema';
import { ObstacleCatalog } from '../config/ObstacleCatalog';
import { CONFIG_SCHEMA_VERSION } from '../config/ConfigRegistry';
import { GameCore } from './GameCore';
import { SeededRng } from './rng';
import { CoreCommand, GameState, RunModeOverrides, StartRunBuffs } from './types';

export const ENGINE_VERSION = '3.8.8-p8.2';

export interface ReplayInputEntry {
    tick: number;
    cmd: CoreCommand;
}

export interface ReplayExternalEvent {
    tick: number;
    type: 'revive';
}

export interface ReplayRecording {
    gameVersion: string;
    configVersion: string;
    seed: number;
    mode: 'endless' | 'journey';
    turnsEnabled: boolean;
    overrides: RunModeOverrides | null;
    startBuffs: StartRunBuffs | null;
    mods: {
        staffCapBonus: number;
        waterReduceBonus: number;
        magnetBonus: number;
        heatResist: number;
        goldMul: number;
    };
    totalTicks: number;
    inputs: ReplayInputEntry[];
    externalEvents: ReplayExternalEvent[];
}

export interface ReplayOutcome {
    fixedTick: number;
    runTime: number;
    dist: number;
    li: number;
    frags: number;
    state: GameState;
    heat: number;
    maxHeat: number;
    cornersPassed: number;
    playerLaneF: number;
    obstacles: { defId: string; lane: number; z: number; passed: boolean }[];
    eventCount: number;
}

/** 单局回放录制器：记录逻辑帧输入与外部事件，并支持异常时导出最小复现 JSON */
export class ReplayRecorder {
    private recording: ReplayRecording;

    constructor(init: {
        seed: number;
        mode: 'endless' | 'journey';
        turnsEnabled: boolean;
        overrides?: RunModeOverrides | null;
        startBuffs?: StartRunBuffs | null;
        mods?: GameCore['mods'];
    }) {
        this.recording = {
            gameVersion: ENGINE_VERSION,
            configVersion: CONFIG_SCHEMA_VERSION,
            seed: init.seed >>> 0,
            mode: init.mode,
            turnsEnabled: init.turnsEnabled,
            overrides: init.overrides ? { ...init.overrides } : null,
            startBuffs: init.startBuffs ? { ...init.startBuffs } : null,
            mods: init.mods
                ? { ...init.mods }
                : { staffCapBonus: 0, waterReduceBonus: 0, magnetBonus: 0, heatResist: 1, goldMul: 1 },
            totalTicks: 0,
            inputs: [],
            externalEvents: [],
        };
    }

    recordCommand(tick: number, cmd: CoreCommand): void {
        this.recording.inputs.push({ tick, cmd: { ...cmd } });
    }

    recordRevive(tick: number): void {
        this.recording.externalEvents.push({ tick, type: 'revive' });
    }

    finish(totalTicks: number): ReplayRecording {
        this.recording.totalTicks = Math.max(0, Math.floor(totalTicks));
        return JSON.parse(JSON.stringify(this.recording)) as ReplayRecording;
    }

    /** 异常发生时导出最小复现数据（JSON 字符串，可直接反序列化喂给 replayRun） */
    exportMinimalRepro(totalTicks: number, errorDetail?: string): string {
        const snap = this.finish(totalTicks);
        return JSON.stringify({
            repro: snap,
            ...(errorDetail ? { error: errorDetail } : {}),
        });
    }
}

/** 按录制数据确定性重放整局游戏并返回终态快照 */
export function replayRun(
    recording: ReplayRecording,
    cfg: GameConfig,
    catalog?: ObstacleCatalog,
): ReplayOutcome {
    const core = new GameCore(cfg, new SeededRng(recording.seed), {
        turnsEnabled: recording.turnsEnabled,
        catalog,
        mode: recording.mode,
        seed: recording.seed,
    });
    core.mods = { ...recording.mods };
    core.startRun({
        seed: recording.seed,
        mode: recording.mode,
        overrides: recording.overrides,
        startBuffs: recording.startBuffs,
    });
    core.drainEvents();

    const inputsByTick = new Map<number, CoreCommand[]>();
    for (const entry of recording.inputs) {
        let list = inputsByTick.get(entry.tick);
        if (!list) { list = []; inputsByTick.set(entry.tick, list); }
        list.push(entry.cmd);
    }
    const extByTick = new Map<number, ReplayExternalEvent[]>();
    for (const ev of recording.externalEvents) {
        let list = extByTick.get(ev.tick);
        if (!list) { list = []; extByTick.set(ev.tick, list); }
        list.push(ev);
    }

    let eventCount = 0;
    for (let t = 0; t < recording.totalTicks; t++) {
        const exts = extByTick.get(t);
        if (exts) {
            for (const ex of exts) {
                if (ex.type === 'revive') core.revive();
            }
        }
        const cmds = inputsByTick.get(t);
        if (cmds) {
            for (const cmd of cmds) core.applyCommand(cmd);
        }
        core.update(GameCore.FIXED_DT);
        eventCount += core.drainEvents().length;
    }

    return {
        fixedTick: core.fixedTick,
        runTime: core.runTime,
        dist: core.dist,
        li: core.li,
        frags: core.frags,
        state: core.state,
        heat: core.heat,
        maxHeat: core.maxHeat,
        cornersPassed: core.cornersPassed,
        playerLaneF: core.playerLaneF,
        obstacles: core.obstacles.map((o) => ({ defId: o.defId, lane: o.lane, z: o.z, passed: o.passed })),
        eventCount,
    };
}
