# dsh-codex-style

一个把 **11 个 Codex 风格交互插件** 合并进来的 DeepSeek Harness Web 客户端插件。
只安装一个 bundle，就能得到侧边栏分区、输入历史、排队消息、文件链接右键、Hover 提示、
长文本粘贴、划选复创、会话前进/后退、左侧图标栏等全部交互；设置里有一个统一的
**「Codex 风格」** 分区，每个子插件占一个 tab，可以单独管理自己的设置和启用状态。

[![Checks](https://img.shields.io/badge/checks-340-brightgreen)](checks/)
[![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.2-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![Runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> 本仓库是正在合并中的单一插件包（合并来源见 `CHANGELOG.md` 与各 feature 源文件头部的
> 来源注释）。旧的独立插件仓库仍然保留，但不再作为安装入口。

## 为什么合并

之前每个交互都是一个独立 bundle，安装、升级、排错和设置入口都要各管一套。合并后：

- 一次安装、一次重启，更新一个版本号
- 只有一个 Host 半边和一份客户端代码，插件之间不再互相等待注入顺序
- 设置集中在 **设置 → Codex 风格**，每个子插件一个 tab
- 某个 feature 构建或应用失败时只影响它自己，不会拖垮其余功能
- 子插件的 localStorage 键、Host 路由和既有数据全部沿用，升级不丢数据

## 故障隔离

任意子插件在**构建、应用、effect、slot 回调或 React 渲染**阶段报错时，都只影响它自己：

- 构建失败：该 feature 被跳过，其余 feature 照常加载
- 应用/effect 失败：它自己的 slot 注册、effect 和监听器会被回收，其他子插件继续运行
- 渲染失败：每个 feature 注册的组件都套着它自己的 React error boundary，崩溃时该组件渲染为空，
  宿主和其他子插件不会白屏；这次崩溃随后会隔离该 feature 并释放它的注册
- 声明了 `requires` 的子插件会在依赖失败时级联标记为「跳过」，而不是带着坏依赖继续跑
- 失败会写入 `dsh.codexStyle.failures`，设置页对应 tab 显示「启动失败 / 已隔离 / 已跳过」和原因；
  重启 DSH 会自动重新尝试，成功加载后记录自动清除

只有 bundle 级强依赖（`dsh.client.inject` 里的平台客户端模块/服务）缺失时，整个插件才会等待——
这和 DSH 对普通插件的硬依赖语义一致。不在隔离范围内：子插件计时器/事件处理器里的异步异常
（浏览器会记录，不会卸载 React 树），以及死循环、超大同步任务这类无法抢占的执行。

## 子插件与设置页

设置 → **Codex 风格** 里的 tab（每个 tab 带启用/禁用开关）：

| Tab | 功能 |
|---|---|
| 侧边栏分区 | 置顶 / 项目 / 最近 / 归档四分区、拖拽排序、行菜单、安全删除与恢复 |
| 左侧图标栏 | Codex 风格 46px 图标栏与会话/插件/自动化/设置入口、品牌菜单 |
| 会话前进 / 后退 | Windows 标题栏的前进/后退按钮与 `Alt+←` / `Alt+→` |
| Hover 与 Tooltip | 统一按钮/标签 hover 与 Codex 风格图标按钮提示 |
| 标签中键关闭 | 鼠标中键关闭侧边栏 / 停靠标签 |
| 长文本粘贴 | 超长粘贴转为 `.txt` 附件，可展开回输入框 |
| 侧栏文件拖入 | 从侧边栏文件列表拖文件到输入框，生成文件引用 |
| 文件链接右键 | 默认应用打开、定位文件夹、复制绝对路径 |
| 输入历史 | 可搜索历史面板与 `↑` 取回上一条 |
| 排队消息 | 撤回、原生行内编辑、整行拖动排序、锁定不发 |
| 划选复创 | 划选文字在右侧栏开临时侧边对话 |

启用/禁用和设置在**完全退出并重新启动 DSH** 后生效，因为每个 feature 只在启动时安装一次
客户端补丁。

## 安装

把本仓库克隆到本地，然后在 Creator 预设的会话里安装 bundle（`target` 必须是绝对路径）：

```text
plugin_manager(action="install_bundle", target="<clone 目录>")
```

也可以用 `dsh plugin` 转发 pnpm，但还要手动把 `dsh-codex-style` 加进
`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`，然后完全重启 DSH：

```powershell
git clone https://github.com/tzhaos/dsh-codex-style.git
dsh plugin --profile desktop add "<clone 目录>"
```

安装后**完全退出 DSH 再启动**。DSH 的浏览器半边只在启动时加载，刷新页面不够。

## 更新

```powershell
cd <clone 目录>
git pull --ff-only
# 完全退出 DSH，再重新启动
```

path-link 安装时不用重新安装，源码更新后重启即可；如果目录、版本或 `cordis.patch.yml`
变化，先 `plugin_manager(action="remove_bundle", ...)` 再 `install_bundle`。

## 兼容性

| 项目 | 值 |
|---|---|
| DSH | `0.2.1-rc.2` |
| 界面 | Web GUI、Desktop Web GUI |
| Node | 22+（仅测试/构建脚本） |
| 构建 | 无运行时构建；`client.js` 由 `node scripts/build-client.mjs` 生成并随仓库提交 |
| 运行时依赖 | 无 |

## 数据与隐私

- 无遥测、无额外服务端、无网络上报
- 侧边栏排序/折叠、输入历史、Hover 设置、feature 启用状态等保存在浏览器 `localStorage`
  （启用状态键：`dsh.codexStyle.features`，故障记录键：`dsh.codexStyle.failures`）
- 排队撤回的文件缓存保存在 `IndexedDB`；锁定状态由 Host 半边的 `$DSH_HOME` 文件持久化
- 会话、消息、Agent 结果始终由 DSH 管理，插件不会修改会话日志

## 限制

- 合并后所有 feature 共享同一次启动；启用/禁用需要重启 DSH
- 故障隔离覆盖构建、应用、effect、slot 回调和 React 渲染；子插件自己的异步回调异常只会被浏览器
  记录，不影响其他插件继续工作，但也不会自动隔离该 feature
- 部分 feature 依赖宿主 DOM / slot 契约（DockKit 标签、`inbox.claim`、宿主按钮
  `aria-label`），DSH 升级时可能需要跟随适配
- 没有提供逐 feature 的独立安装包；只需要其中一两个功能时，仍可继续使用旧的独立插件仓库

## 开发

```powershell
node scripts/build-client.mjs          # 从 src/ 重新生成 client.js
node scripts/build-client.mjs --check  # 校验 client.js 与源码一致
node scripts/check.mjs                 # 全量零依赖检查
```

源码结构：

```text
.
├── index.js                 # Host 半边：排队消息路由与 inbox claim 补丁
├── client.js                # 生成的浏览器 bundle（不要手改）
├── src/
│   ├── features/            # 11 个合并 feature，各自保持原实现
│   ├── isolation.js         # 每个 feature 的构建/应用/渲染隔离与故障记录
│   └── settings.js          # 设置 shell：Codex 风格分区与每 feature 一个 tab
├── checks/                  # 零依赖检查，按 feature 拆分
├── scripts/
│   ├── build-client.mjs     # 生成 client.js
│   └── check.mjs            # 运行全部检查
├── locale/
├── cordis.patch.yml
└── CHANGELOG.md
```

当前检查规模：**14 个检查文件、340 项零依赖检查**（约 3 秒跑完）：

```text
all checks passed: 14 files, 340 checks, 2.6s
```

提交前请运行 `node scripts/check.mjs`；`client.js` 是生成产物，改动 `src/` 后必须重新生成。

## 许可证

[MIT](LICENSE)。
