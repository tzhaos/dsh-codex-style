# Codex 工作台

为 DeepSeek Harness 提供 Codex 风格的导航、消息输入、内容操作和侧边面板。
安装名和模块 ID 保留为 `dsh-codex-style`，兼容现有安装与设置。

适配基线：DSH `0.2.1-rc.2`；构建和检查使用 Node.js 22 以上版本。无运行时第三方依赖。

## 功能

设置 → **Codex 工作台** 按任务分组。每项能力可以独立启用和停用。

| 分组 | 能力 |
|---|---|
| 会话与导航 | 会话列表、左侧导航栏、会话前进与后退 |
| 消息输入 | 排队消息（编辑即撤回输入框、锁定切换、拖拽排序/合并含附件）、输入历史、长文本粘贴（存为临时 txt 文件引用）、拖入文件引用、选区引用、输入框内联状态 |
| 内容操作 | 文件操作菜单、附件操作菜单、选区工具栏 |
| 侧边面板 | 临时侧聊、中键关闭标签 |
| 通用交互 | 悬停提示 |

顶栏顺序为 **后退 → 前进 → 显隐侧栏 → 原生菜单**。
导航栏复用 DSH 的 SVG 图标，激活态沿用原轮廓并调整填充、反色和线宽。
新对话的标题居中，输入框靠底部排列；颜色跟随 DSH 主题。

## 跨区域操作

选区工具栏负责读取对话正文中的选中文字。
消息输入和侧边面板各自注册可用动作，通过 `{ sessionId, text }` 接收上下文。
停用动作提供方后，入口随注册一起移除。

模块边界、状态归属和生命周期见 [架构说明](docs/ARCHITECTURE.md)。
修复记录、依据与验证范围见 [审查报告](docs/REVIEW.md)。

## 安装与更新

在 DSH Creator 会话中安装本地 bundle，`target` 使用克隆目录的绝对路径：

```text
plugin_manager(action="install_bundle", target="<clone 目录的绝对路径>")
```

也可以通过 CLI 安装：

```powershell
git clone https://github.com/tzhaos/dsh-codex-style.git
dsh plugin --profile desktop add "<clone 目录的绝对路径>"
```

CLI 安装后，把 `dsh-codex-style` 加入桌面 profile 的 `dsh.profile.bundles`。
使用本地路径链接的现有安装，更新源码即可。

完全退出并重新启动 DSH 后，客户端 bundle 和能力开关才会生效。

## 数据

- 列表排序、折叠、历史输入、选区引用和能力开关保存在此浏览器。
- 旧的 `dsh.sidebarSections.*`、`dsh.composerHistory.*`、`dsh.quickFork.*` 和 `dsh.codexStyle.*` 设置键保留。
- 排队附件缓存使用 IndexedDB。文件按上传回执匹配，过期缓存不参与撤回。
- 排队消息不提供原地编辑：行内的「编辑」按钮会把消息（含可回填的附件）撤回输入框，再按普通草稿修改和发送。输入框已有内容时会先确认，避免覆盖草稿。
- 排队消息始终展开，不提供折叠；行首消息图标本身是锁定切换（锁住时变锁形），拖拽使用它左侧的抓手；引导、删除等操作保留原生按钮与提示。
- 排队消息的图片预览使用宿主原生 `ImageLightbox`（与输入框/正文一致），排队附件支持原生右键菜单；拖动合并排队消息时文本与双方附件一起保留。
- 输入框底部的上下文环与两个统计项仍是三个独立的图标按钮，点开各自打开宿主的详情面板。
- 消息锁定状态写入 `$DSH_HOME/queue-withdraw-frozen.json`，使用原子替换；保存失败会撤销本次锁定操作。
- 临时侧聊关闭时停止并归档子会话，消息仍由 DSH 保存。

旧版“划选复创”拆为选区工具栏、选区引用和临时侧聊。
已有停用状态会继承到拆出的能力；单独设置新能力后，以新设置为准。

## 开发

```powershell
node scripts/build-client.mjs
node scripts/check.mjs
```

`client.js` 是生成文件。构建顺序和源码位置由 `src/catalog.json` 统一管理。
构建输出仍是一个浏览器模块，每项能力有独立的错误边界和清理范围。

```text
src/
  navigation/     会话列表与导航
  composer/       输入状态、历史、附件和选区引用
  conversation/   正文选区与文件操作
  panels/         侧聊和面板标签
  shared/         主题呈现、官方图标适配、动作注册与故障隔离
  settings.js     按任务分组的设置页
  catalog.json    能力 ID 与源码清单
```

独立 UI 验证使用本机安装中的公开组件，不连接 DSH 服务：

```powershell
node scripts/extract-dsh-ui.mjs
node scripts/review-ui.mjs
```

第二条命令输出私有的本机地址和 Playwright 配置路径。
使用独立、静音、无界面的浏览器会话运行 `checks/fixtures/verify-ui.js`。
提取文件保存在被 Git 忽略的 `node_modules/.review-upstream`。

宿主 DOM 适配集中在导航、呈现和队列装饰模块。
升级 DSH 后，需要重新核对官方组件和选择器。

[MIT](LICENSE)
