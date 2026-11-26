# 总体路线图

> 目标：第三人称**真3D**无尽跑酷微信小游戏，可正式发布、长期运行、通过 IAA 广告获益。引擎锁定 Cocos Creator **3.8.8** + TypeScript。
> 2026-11-26 Phase 8 独立审查后更新；阶段编号以任务书与 PHASE*_REPORT.md 为准。

## 阶段总览

| 阶段 | 内容 | 状态 | 证据 |
|------|------|------|------|
| P0 | 技术调研与工程初始化 | ✅ 完成 | PHASE0_REPORT.md |
| P1 | 3D 跑酷核心系统 | ✅ 完成 | PHASE1_REPORT.md |
| P2 | 无限地图与程序化生成 | ✅ 完成 | PHASE2_REPORT.md |
| P3 | 障碍、道具与动态难度 | ✅ 完成 | PHASE3_REPORT.md |
| P4 | 夸父逐日特色玩法 | ✅ 完成 | PHASE4_REPORT.md |
| P5 | 3D 美术、动画与音频 | ✅ 完成 | PHASE5_REPORT.md |
| P6 | 完整游戏与成长系统 | ✅ 完成（Phase 8 修复接线缺陷） | PHASE6_REPORT.md / PHASE8_REPORT.md |
| P7 | 微信适配与 IAA 广告 | ✅ 代码完成；真实广告待广告位 | PHASE7_REPORT.md / PHASE8_REPORT.md |
| P8 | 独立审查、压力/平衡/性能、修复 | ✅ 完成 | PHASE8_REPORT.md |

## 剩余验收（不属于代码可独立完成）

- [ ] 真机兼容矩阵：Android 低/中/高、iOS；触控延迟、发热、音频、生命周期、存档、广告（当前无设备，见 PHASE8_REPORT.md）
- [ ] 微信公众平台：开通流量主、创建 5 个激励视频与插屏广告位，填入 `game-config.json` 并设 `ad.mode='wx'` 后真机验证
- [ ] 微信开发者工具服务端口开启 + 扫码登录，确认主包体积与分包配置（实测构建目录 10.4MB，引擎占 7.2MB）
- [ ] 编辑器/浏览器人工视觉与手感调优（低/中/高画质档位已配置化，默认中档）
