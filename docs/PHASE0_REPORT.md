# Phase 0 报告 —— 技术调研与工程初始化

> 日期：2026-11-25。对应任务书五个部分逐项给出结论与证据；工程实施记录见 PROGRESS.md / TEST_REPORT.md。

## 0. 与既有工作的关系（重要）

本仓库在此前会话已完成任务书要求的多数工程项（Git 初始化、引擎锁定、模块化架构、自动化测试、微信构建实测、3D 最小场景），本阶段在其上补齐：开源调研、平台合规调研、全模块架构地图、日志/错误处理机制、跨平台构建、代码规范（ESLint）、环境文档与阶段报告。阶段编号映射：任务书 "Phase 0" ↔ 本仓库 ROADMAP 的 P0（原型）+ P1（架构）已有成果 + 本轮补充。不对既有成果重复叙述。

## 1. 开源项目调研 → `docs/REFERENCE_PROJECTS.md`

- **6/6 仓库全部实际拉取**（GitHub API 元数据 + 关键源码逐行），无失效仓库，无需替代搜索；对停更/低质仓库做了官方替代调研（cocos/example-3d → 重定向至 cocos-example-projects，同样无许可证）。
- **授权边界结论**：仅 thegreatidea/3D-Endless-Runner-Unity 代码 MIT 可商用复用（且其 Assets 内第三方资产 BOXOPHOBIC 等被 MIT 排除）；Unity Trash Dash 按 Asset Store EULA 管理（第三方声明文件实测）；其余 4 仓无许可证 = 保留所有权利。
- **决策**：不 Fork，全部自主实现（P1 已是自主实现）。设计借鉴清单 6 项已入报告（转弯+输入缓冲、道具三件套、状态机栈、tile 分段池化、多广告点位、弯曲世界）。

## 2. 开发环境 → `docs/ENVIRONMENT.md`

- 版本锁定：Creator **3.8.8**（微信 3D 构建已实测）、Node 22.20、TS **5.9**（因 typescript-eslint peer 约束从 7 降级，Creator 编辑器编译不受影响）、Vitest、ESLint(flat)。
- 工具链命令：`lint → test → type-check → build` 四步全绿（见 §4 回归记录）。
- Git 忽略规则覆盖缓存/生成物；项目无密钥文件。
- 跨平台：构建脚本按 OS 探测 Creator（含 Windows Dashboard 路径与环境变量覆盖）；**Windows 分支未实测**（本机 macOS），已在文档标注。

## 3. 技术架构 → `docs/ARCHITECTURE.md`（本轮重写）

- 任务书 13 个模块域逐一映射到仓库落点，标注 ✅/🅿️ 与拆分触发条件；依赖方向图明确 "core 不得依赖 cc/render/input/platform"（以 Node 可运行性为硬约束）。
- 本轮落地的新机制：`core/Logger`（四级日志）、`platform/ErrorHooks`（wx/浏览器全局错误捕获，微信端自动进 jsError 统计）、启动期 fail-fast（配置校验）、生命周期文档化。
- 3D 场景补齐平行光（当前 unlit 不参与光照，为 P2 standard 材质预留）。

## 4. 技术验证（全部实测）

| 验证项 | 结果 |
|--------|------|
| 最小 3D 场景 | ✅ 地面/角色占位（程序化夸父剪影）/透视相机/平行光/移动逻辑（Renderer3D） |
| TypeScript 检查 | ✅ `npm run type-check` 0 错误 |
| 自动化测试 | ✅ `npm test` 53/53 |
| 代码规范 | ✅ `npm run lint` 0 错误（修复 71 处缩进 + 2 处死代码） |
| 引擎构建（微信） | ✅ CLI 构建 wechatgame 成功，Missing class=0，Game/Logger/ErrorHooks/DirectionalLight 均入 `assets/main/index.js` |
| 浏览器预览 | ⏳ 人工项（需编辑器 GUI，见 PROGRESS 人工验证清单） |
| 微信开发者工具导入 | ⏳ 阻塞已明确记录：服务端口未开启（CLI 报 `.cli` ENOENT）+ 需扫码登录；开启方法已写入文档 |

## 5. 平台合规调研 → `docs/COMPLIANCE.md`

全部逐条对官方文档核实（IAA 开通三条件 UV>500 / 游戏圈 / 关联主体；2024 起新小游戏强制 ICP 备案；个人主体无内购免版号但需软著+自审自查报告；包体主包≤4M 总包≤30M；健康系统平台侧继承；广告规范红线）。7 项 ⏳ 明确标记"待后台验证"（个人主体流量主资格、类目实际列表、软著替代方案等），未沿用任何未证实政策。

## 6. 验收标准对照

| 验收标准 | 状态 |
|----------|------|
| 项目可正常初始化、启动和构建 | ✅（构建实测通过；"启动"的编辑器/微信端视觉运行为人工项，已记录） |
| 引擎及工具链版本明确 | ✅ ENVIRONMENT.md 锁定 |
| 开源代码和素材授权边界明确 | ✅ REFERENCE_PROJECTS.md 逐仓边界 + ASSET_LICENSES 红线 |
| 基础架构和开发文档完整 | ✅ docs/ 10 份文档（原 8 份 + REFERENCE_PROJECTS + COMPLIANCE + ENVIRONMENT + 本报告） |
| 自动化测试能够运行 | ✅ 53/53 + lint + type-check |
| 微信构建可行性实际验证 / 阻塞记录 | ✅ 构建链路实测通过；开发者工具导入的阻塞（服务端口+登录）已明确记录为人工项 |
| Git 提交和 Phase 0 报告 | ✅ 本报告 + 原子提交（见 git log） |

## 7. 遗留与风险

1. Windows 构建分支未实测（无 Windows 环境）——首次 Windows 使用时验证 `CREATOR_PATH` 探测。
2. TypeScript 从 7 降级到 5.9：为本轮变更，已回归测试/类型检查/构建全绿；如未来升级 TS 须等 typescript-eslint 支持。
3. 微信开发者工具运行时验证：依赖用户开启服务端口并登录（唯一的真机前人工步骤）。
4. 软著办理周期 1~3 个月，建议 P3 启动（COMPLIANCE 行动项）。
