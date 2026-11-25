# 开发环境与工具链（Phase 0 实测）

> 2026-11-25 在 macOS (darwin 27.2.0, arm64) 实测；Windows 适配见 §4（本机无 Windows 环境，标注未实测项）。

## 1. 版本清单（锁定）

| 工具 | 版本 | 备注 |
|------|------|------|
| Cocos Creator | **3.8.8**（`/Applications/CocosCreator.app`） | 项目锁定；3.8.x LTS 线，微信小游戏 3D 构建已实测通过（见 §5） |
| Node.js | **22.20.0** | 运行测试/工具链；≥18 满足微信 CLI 要求 |
| npm | 10.9.3 | **必须用 `--registry=https://registry.npmmirror.com`**（默认源长时间挂起，实测） |
| TypeScript | **~5.9.3**（devDependency） | 固定 5.9 线：typescript-eslint 要求 TS <6.1，且 Creator 编辑器自带编译不受影响 |
| ESLint | typescript-eslint 8.x（flat config） | `npm run lint` |
| Vitest | 3.x | `npm test`（53 项） |
| Git | 系统 git | 分支 `main`；远程未配置（规范：未经授权不推送） |
| 微信开发者工具 | 已安装（`/Applications/wechatwebdevtools.app`） | **服务端口未开启** → CLI 报 `.cli` ENOENT；首次使用需人工开启端口 + 扫码登录 |

## 2. 命令速查

```bash
npm test          # vitest 单元测试
npm run type-check# tsc --noEmit（继承 Creator tsconfig + cc.d.ts）
npm run lint      # ESLint
bash scripts/build-wechat.sh   # 微信包构建（跨平台，见 §4）
```

顺序建议：`lint → test → type-check → build`（提审前四项全绿）。

## 3. Git 忽略规则

`.gitignore`：`library/ temp/ local/ build/ native/ node_modules/ coverage/ .DS_Store`、`extensions/cocos-mcp-server/node_modules/`。
- `settings/`、`profiles/`、`assets/**.meta` 全部入库（Creator 工程协作必需）。
- 密钥：本项目无密钥文件；若后续加入小程序 upload 私钥，放 `~/` 下不入库并在 RELEASE_CHECKLIST 核对。

## 4. 跨平台开发流程（Windows / macOS）

- 构建脚本 `scripts/build-wechat.sh`：自动探测 Creator（macOS 固定路径 / Windows Dashboard 安装目录取最新版本号），支持 `CREATOR_PATH`、`ZHURI_PROJECT` 环境变量覆盖。⚠️ Windows 分支未实测（本机 macOS），首次在 Windows 使用时如遇路径问题按脚本内提示设置 `CREATOR_PATH`。
- 编辑器预览、微信开发者工具流程两平台一致（GUI 操作）。
- 全部命令（§2）在 PowerShell/Git Bash 下通用（npm scripts 层面）。

## 5. 引擎版本可行性证据（实测记录）

- 3D 场景（透视相机 + MeshRenderer + DirectionalLight + builtin-unlit）CLI 构建微信包成功，`assets/main/index.js` 包含全部用户脚本与类注册，Missing class = 0（详见 TEST_REPORT P0/P1 构建记录）。
- 微信端运行验证待服务端口开启后进行（已列人工验证项）。
