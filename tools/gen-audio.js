#!/usr/bin/env node
/**
 * 音频合成器（Phase 5）—— 纯 Node 无依赖，输出 16bit PCM WAV。
 * 全部原创程序化生成（国风五声音阶 + 合成音效），零第三方授权。
 * 用法：node tools/gen-audio.js  →  输出到 assets/resources/audio/*.wav
 */
const fs = require('fs');
const path = require('path');

const SR = 22050;
const OUT = path.join(__dirname, '..', 'assets', 'resources', 'audio');
fs.mkdirSync(OUT, { recursive: true });

/** 写单声道 16bit WAV */
function writeWav(name, samples) {
    const dataLen = samples.length * 2;
    const buf = Buffer.alloc(44 + dataLen);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataLen, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);            // PCM
    buf.writeUInt16LE(1, 22);            // mono
    buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * 2, 28);       // byte rate
    buf.writeUInt16LE(2, 32);            // block align
    buf.writeUInt16LE(16, 34);           // bits
    buf.write('data', 36);
    buf.writeUInt32LE(dataLen, 40);
    for (let i = 0; i < samples.length; i++) {
        let v = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    fs.writeFileSync(path.join(OUT, name + '.wav'), buf);
    console.log(`${name}.wav  ${(buf.length / 1024).toFixed(0)}KB`);
}

const TAU = Math.PI * 2;
const sec = (t) => Math.round(t * SR);

/** 衰减正弦音符（拨弦感：指数衰减 + 二次谐波） */
function pluck(buf, at, freq, dur, vol = 0.5, decay = 5) {
    const n0 = sec(at), n1 = Math.min(buf.length, sec(at + dur));
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / SR;
        const env = Math.exp(-decay * t);
        buf[i] += vol * env * (Math.sin(TAU * freq * t) + 0.35 * Math.sin(TAU * freq * 2 * t) + 0.12 * Math.sin(TAU * freq * 3 * t));
    }
}

/** 噪声突发（脚步/打击） */
function noiseBurst(buf, at, dur, vol, lp = 0.4) {
    const n0 = sec(at), n1 = Math.min(buf.length, sec(at + dur));
    let last = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / dur;
        const env = (1 - t) * Math.min(1, t * 30);
        const w = Math.random() * 2 - 1;
        last = last * lp + w * (1 - lp);          // 一阶低通
        buf[i] += vol * env * last;
    }
}

/** 扫频（冲刺/神通） */
function sweep(buf, at, dur, f0, f1, vol = 0.4) {
    const n0 = sec(at), n1 = Math.min(buf.length, sec(at + dur));
    let phase = 0;
    for (let i = n0; i < n1; i++) {
        const t = (i - n0) / dur;
        const f = f0 + (f1 - f0) * t;
        phase += TAU * f / SR;
        const env = Math.sin(Math.PI * t);
        buf[i] += vol * env * Math.sin(phase);
    }
}

// ================= BGM：五声音阶（宫商角徵羽）古筝风循环 =================
// A 宫调五声：A3 C4 D4 E4 G4 A4 C5 D5 E5
const PENTA = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26];
function genBgm() {
    const dur = 19.2;                       // 循环长度（拍长公倍数）
    const buf = new Float32Array(sec(dur));
    const bpm = 72, beat = 60 / bpm;
    // 低音持续音（宫）
    for (let i = 0; i < buf.length; i++) {
        const t = i / SR;
        buf[i] += 0.10 * Math.sin(TAU * 110 * t) + 0.06 * Math.sin(TAU * 55 * t);
    }
    // 主题乐句（两段各 9.6s，五声拨弦 + 空拍留白）
    const phrase = [
        [0, 5], [1, 6], [2, 7], [1, 6], [0, 5], [null, 0], [3, 8], [4, 5],
        [4, 8], [3, 7], [2, 6], [1, 5], [0, 5], [null, 0], [null, 0], [2, 7],
    ];
    for (let rep = 0; rep < 2; rep++) {
        const off = rep * 9.6;
        phrase.forEach(([idx, p], k) => {
            if (idx === null) return;
            pluck(buf, off + k * beat * 1.2, PENTA[idx] * (rep ? 1 : 1), beat * 1.6, 0.34 - k * 0.008);
            if (k % 4 === 0) pluck(buf, off + k * beat * 1.2 + beat * 0.6, PENTA[idx + 2], beat * 1.2, 0.16); // 装饰音
        });
        // 尾音落宫
        pluck(buf, off + 9.6 - beat, PENTA[0] * 2, beat * 2.4, 0.3, 3.2);
    }
    // 轻鼓点（低频噪声，逢 4 拍）
    for (let b = 0; b < 16; b++) noiseBurst(buf, b * beat * 1.2, 0.09, b % 4 === 0 ? 0.30 : 0.14, 0.12);
    // 归一化
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    for (let i = 0; i < buf.length; i++) buf[i] *= 0.92 / peak;
    writeWav('bgm_main', buf);
}

// ================= 环境风声循环 =================
function genWind() {
    const dur = 6.0;
    const buf = new Float32Array(sec(dur));
    let lp = 0, lp2 = 0;
    for (let i = 0; i < buf.length; i++) {
        const t = i / SR;
        const w = Math.random() * 2 - 1;
        lp = lp * 0.985 + w * 0.015;                       // 深低通风声
        lp2 = lp2 * 0.6 + w * 0.4;
        const gust = 0.5 + 0.5 * Math.sin(TAU * t / dur * 2);  // 循环无缝（整周期起伏）
        buf[i] += (lp * 2.2 + lp2 * 0.10) * (0.5 + 0.5 * gust);
    }
    // 首尾交叉淡化保证无缝循环
    const fade = sec(0.3);
    for (let i = 0; i < fade; i++) {
        const k = i / fade;
        buf[i] *= k;
        buf[buf.length - 1 - i] *= k;
    }
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    for (let i = 0; i < buf.length; i++) buf[i] *= 0.8 / peak;
    writeWav('amb_wind', buf);
}

// ================= 音效 =================
function genSfx() {
    // 脚步（短噪声拍，两声以供交替）
    for (const [name, vol] of [['sfx_footstep_a', 0.5], ['sfx_footstep_b', 0.42]]) {
        const buf = new Float32Array(sec(0.09));
        noiseBurst(buf, 0, 0.07, vol, 0.25);
        writeWav(name, buf);
    }
    // 金币/阳炎（五声高音双拨）
    {
        const buf = new Float32Array(sec(0.35));
        pluck(buf, 0, 880, 0.16, 0.5, 9);
        pluck(buf, 0.06, 1318.5, 0.22, 0.4, 8);
        writeWav('sfx_coin', buf);
    }
    // 跳跃（上扫）
    {
        const buf = new Float32Array(sec(0.28));
        sweep(buf, 0, 0.24, 330, 660, 0.35);
        writeWav('sfx_jump', buf);
    }
    // 落地（低频拍）
    {
        const buf = new Float32Array(sec(0.16));
        noiseBurst(buf, 0, 0.1, 0.5, 0.1);
        pluck(buf, 0, 98, 0.12, 0.5, 14);
        writeWav('sfx_land', buf);
    }
    // 滑铲（下扫 + 摩擦）
    {
        const buf = new Float32Array(sec(0.4));
        sweep(buf, 0, 0.3, 520, 180, 0.3);
        noiseBurst(buf, 0.05, 0.3, 0.28, 0.55);
        writeWav('sfx_slide', buf);
    }
    // 受击/踉跄（低沉冲击）
    {
        const buf = new Float32Array(sec(0.3));
        noiseBurst(buf, 0, 0.14, 0.6, 0.08);
        pluck(buf, 0, 130.8, 0.25, 0.55, 11);
        writeWav('sfx_hit', buf);
    }
    // 死亡（下行三音）
    {
        const buf = new Float32Array(sec(0.9));
        pluck(buf, 0, 392, 0.3, 0.4, 6);
        pluck(buf, 0.25, 329.63, 0.3, 0.4, 6);
        pluck(buf, 0.5, 261.63, 0.38, 0.45, 5);
        writeWav('sfx_death', buf);
    }
    // 复活（上行琶音）
    {
        const buf = new Float32Array(sec(0.7));
        [261.63, 329.63, 392, 523.25].forEach((f, i) => pluck(buf, i * 0.1, f, 0.3, 0.35, 7));
        writeWav('sfx_revive', buf);
    }
    // 冲刺/御风（快速双扫）
    {
        const buf = new Float32Array(sec(0.5));
        sweep(buf, 0, 0.4, 220, 880, 0.35);
        sweep(buf, 0.05, 0.4, 440, 1760, 0.15);
        writeWav('sfx_dash', buf);
    }
    // 神杖破障（木鱼式敲击 + 碎裂）
    {
        const buf = new Float32Array(sec(0.32));
        pluck(buf, 0, 660, 0.1, 0.5, 18);
        noiseBurst(buf, 0.04, 0.2, 0.4, 0.35);
        writeWav('sfx_staff', buf);
    }
    // 巨人之跃（深蹲起跳）
    {
        const buf = new Float32Array(sec(0.4));
        pluck(buf, 0, 164.8, 0.3, 0.5, 8);
        sweep(buf, 0.08, 0.26, 165, 495, 0.22);
        writeWav('sfx_leap', buf);
    }
    // 饮水/甘霖（气泡上泛）
    {
        const buf = new Float32Array(sec(0.5));
        [0.02, 0.1, 0.19, 0.3, 0.4].forEach((at, i) => sweep(buf, at, 0.09, 300 + i * 120, 700 + i * 200, 0.22));
        writeWav('sfx_water', buf);
    }
    // 护盾（钟声）
    {
        const buf = new Float32Array(sec(0.7));
        pluck(buf, 0, 523.25, 0.6, 0.4, 3.5);
        pluck(buf, 0, 1046.5, 0.4, 0.15, 4);
        writeWav('sfx_shield', buf);
    }
    // 磁吸（电味上滑）
    {
        const buf = new Float32Array(sec(0.35));
        sweep(buf, 0, 0.3, 440, 880, 0.28);
        pluck(buf, 0.24, 880, 0.12, 0.3, 10);
        writeWav('sfx_magnet', buf);
    }
    // 倍率（五声快速上行）
    {
        const buf = new Float32Array(sec(0.45));
        [523.25, 587.33, 659.26, 783.99].forEach((f, i) => pluck(buf, i * 0.08, f, 0.2, 0.3, 9));
        writeWav('sfx_double', buf);
    }
    // 转弯（号角短音）
    {
        const buf = new Float32Array(sec(0.3));
        pluck(buf, 0, 293.66, 0.24, 0.42, 4);
        writeWav('sfx_turn', buf);
    }
    // UI（宫音轻点）
    {
        const buf = new Float32Array(sec(0.14));
        pluck(buf, 0, 523.25, 0.12, 0.4, 12);
        writeWav('sfx_ui', buf);
    }
    // 保底甘霖提示（双音提醒）
    {
        const buf = new Float32Array(sec(0.4));
        pluck(buf, 0, 587.33, 0.16, 0.35, 8);
        pluck(buf, 0.12, 880, 0.2, 0.3, 7);
        writeWav('sfx_pity', buf);
    }
}

genBgm();
genWind();
genSfx();
console.log('音频生成完毕 →', OUT);
