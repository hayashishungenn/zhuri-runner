# 逐日 · 夸父逐日神话跑酷（Cocos Creator 3.8.8 + 微信小游戏）

全代码驱动的 2D 跑酷：场景里只有一个 Game 节点，所有画面由 `Game.ts` 用 Graphics 每帧绘制。

## 首次打开
1. 打开 `/Applications/CocosCreator/CocosCreator.app`（Dashboard 不需要，编辑器已就位）
2. 项目 → 导入 → 选择本目录 `~/Projects/zhuri-runner` → 打开
3. 双击 `assets/scenes/main.scene`，点顶部预览按钮（浏览器 ▶）即可试玩

## 若场景加载报错（兜底方案）
1. 资产面板右键 → 新建 → 场景，双击打开（默认带 Canvas）
2. 把 `assets/scripts/Game.ts` 拖到层级面板的 **Canvas** 节点上
3. 预览

## 设计分辨率
已在 `settings/v2/packages/project.json` 设为 720×1280 / 适配宽度。
如预览比例不对：项目 → 项目设置 → 项目数据 → 设计分辨率 720×1280，勾「适配宽度」。

## 构建微信小游戏
1. 菜单 项目 → 构建发布 → 平台选「微信小游戏」→ 填入你的小程序 appid → 构建
2. 微信开发者工具 → 导入项目 → 目录选 `build/wechatgame`
3. 开发者工具 设置 → 安全设置 → 打开服务端口（供 CLI/自动化）
4. 预览 OK 后：开发者工具右上角「上传」→ mp.weixin.qq.com 提交审核

## 广告接入（TODO）
`Game.ts` 的 `tapRevive()` 里有标注：真机用 `wx.createRewardedVideoAd({adUnitId})`
替换模拟广告；广告位 ID 在 mp 后台「流量主 → 广告位管理」创建（激励视频）。
