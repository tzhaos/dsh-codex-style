# 审查与修复记录

2026-10-20。已审查宿主入口、全部能力、设置页和故障隔离层。
修复已写入当前仓库；没有重启正在使用的 DSH。

## 依据

本机版本为 DSH `0.2.1-rc.2`，Desktop 构建提交为 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`。
API 与样式以本机安装中的公开源码和组件为准。

- [官方 Web 样式规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/web-styling.zh.md)
- [官方圆角规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/ui-radius.zh.md)
- [官方 slot 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/subsystems/slots.zh.md)
- [官方生命周期规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md)
- [dsh-market 组件复用与挂载方式](https://github.com/dsh-market/dsh-market/blob/29dcbd78290be89d83771e3734b128be110645c5/src/client/index.ts)
- [dsh-context 注册与可选能力注入](https://github.com/bowenliang123/dsh-context/blob/1bc481c8f1d73b65d2710ede2b0dd3f6af7c5c6d/src/client/index.ts)

## 修复

| 问题 | 处理 | 回归依据 |
|---|---|---|
| 图片附件无法删除 | 移除丢失 `this` 的方法补丁，订阅公开状态 | 原生编辑器删除后，附件 ID 和预览资源均释放 |
| 跨会话队列编辑可能错路由 | 移除共享会话服务补丁，显式传递会话 ID | 原方法身份保持不变；附件使用宿主弹窗编辑 |
| 上传期间的队列变化被旧快照覆盖 | 上传后重新读取队列并校验目标 | 新消息保留；已取走的消息不会重新出现 |
| 撤回失败覆盖新草稿 | 比较草稿版本，只恢复仍由本次操作拥有的状态 | 延迟失败期间的新输入保留 |
| 提交中移除长文本附件 | 遵守 InputShell 的阶段与删除返回值 | 忙碌时不释放附件；拒绝新增时回收上传草稿 |
| 切换会话丢失附件恢复记录 | 新 shell 恢复完成前保留待恢复文件 | 拒绝后可重试，失败生成的附件会释放 |
| 锁定附件行导致观察器循环 | 统一计算禁用状态，只写入实际变化 | 观察器收敛，按钮不反复启用和禁用 |
| 拖拽直接移动 React 拥有的行 | 只显示插入提示，提交完整排序 | 取消拖拽不提交，宿主按成功结果更新 DOM |
| 锁定文件写入失败仍报告成功 | 原子替换文件，失败时回滚内存状态 | 模拟写入失败返回错误并保留旧状态 |
| 中文输入法确认误发侧聊 | 识别组合输入事件 | 组合输入的 Enter 不发送 |
| 迟到回执清空下一条侧聊草稿 | 只清空未被继续编辑的提交版本 | 发送期间的新草稿保留 |
| 关闭中的侧聊创建或绑定继续执行 | 归档迟到子会话，逐步检查取消状态 | 创建完成后关闭、retain 释放和重载场景 |
| 失败恢复截断新增引用 | 恢复和读取时不截断已接受的数据 | 24 条恢复引用在重载后仍保留 |
| 文件引用损坏合法文件名 | 保留路径原值，单独解析 file URI | 右括号、方括号和 URI 转义回归 |
| 老导航失败回滚新导航 | 使用导航修订号 | 较早失败不会改写较新位置 |
| 嵌套服务 effect 错绑根范围 | 绑定实际注入上下文 | 子上下文释放会清理自己的 effect |
| UI 尺寸、顶栏顺序和图标混杂 | 统一尺寸，复用官方 SVG 与控件 | 几何测量、深浅主题和窄窗口截图 |
| 临时诊断持续写入磁盘 | 移除布局探针及诊断路由 | 构建检查不再包含诊断上传和追加日志 |

## 验证

普通检查使用独立 VM 和临时宿主目录。
UI fixture 使用本机 DSH 的 React、编辑器、附件栏和 UI primitives。
浏览器使用独立、静音、无界面的 Edge 会话，服务只绑定私有本机端口。
测试操作仅修改 fixture 的示例会话和草稿。

复现命令和源码入口见 [README](../README.md)。
截图保存在 `output/playwright/`。

实际 DSH 的网络传输、外部文件应用和 Electron 窗口未被操作。
Windows 原生菜单的位置根据已核对的 preload CSS 变量适配。
当前桌面 profile 已通过路径链接指向此仓库，完全重启 DSH 后加载新 bundle。
