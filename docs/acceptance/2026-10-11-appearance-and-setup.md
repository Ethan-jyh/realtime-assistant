# 配置、外观与窗口生命周期验收
+
+日期：2026-10-11。密钥没有写入本文件、源码或仓库。
+
+## 已完成
+
+- DeepSeek：API 前缀 https://api.deepseek.com/v1，模型 deepseek-flash。模型名依据当前官方价格/模型页面；默认支持思考模式。
+- 阿里 ASR：qwen-audio-3.1-asr-flash-streaming，北京默认 WebSocket 地址。独立密钥保存至 vault，配置状态明确显示“实时转写待接入”。本轮不采集音频，尚未实现真实 ASR 链路。
+- 两套密钥在实际应用的 /Users/air/Library/Application Support/local-realtime-assistant/secrets.vault 加密保存；保存返回 persistent:true、asrPersistent:true。公开配置不含密钥。
+- 20–100% 浮窗不透明度，原生 BrowserWindow.setOpacity，串行原子保存，重启恢复。数值越低越透明，仅影响浮窗。
+- 根据原应用发布样式重写暗色半透明壳、16px 圆角、细边框、紧凑输入框、白色按钮和浮窗；源码自行编写。保护窗口的原应用截图为空白，不能声称完成像素级一致性验证。
+- 标题栏可拖动、设置页最小化/关闭、浮窗设置/展开收起/隐藏按钮已接线；顶部导航固定可见。
+
+## 截图崩溃的修复
+
+用户截图是主进程 Object has been destroyed，堆栈指向 BrowserWindow.visibilityChanged。官方 Electron browser-window 源码为 show/hide/minimize/maximize/restore 注册内部监听，回调访问 isVisible/isMinimized，没有已销毁保护。
+
+在旧代码中销毁真实窗口再派发迟到事件，hide/show/minimize/restore/ready-to-show 都复现 Object has been destroyed。修复在 closed 后清理这些终态监听、清空旧窗口引用，ready-to-show 绑定具体窗口并检查存活，窗口策略也检查存活。没有用全局 uncaughtException 吞掉错误。
+
+新增真实窗口回归通过；连续 10 次关闭重开设置页通过。这是对截图同类生命周期路径的修复，不是对其他未知崩溃的全面保证。
+
+## 验证
+
+56 个单元测试通过；类型检查、构建及 git diff --check 通过。5 个 Electron 端到端场景覆盖模型流程、透明度/重启、双窗口，以及两个生命周期回归。标准 npm run dev 已启动，控制台 http://localhost:5173；原生界面读取确认 DeepSeek/阿里模型配置、ASR 状态、透明度滑块已呈现。
+
+联网鉴权验证曾被自动审批拒绝，理由为未获得具体密钥外发验证授权；已改为仅本机保存并完成此项。因此真实模型鉴权与阿里实时接口仍未验证。模拟模型流程通过不等于真实供应商已验收。
+
+## 启动
+
+```bash
+cd /Users/air/.codex/worktrees/realtime-assistant-plan/REA
+npm run dev
+```
+
+当前依赖已安装。旧进程若仍弹错，关闭旧窗口/在旧终端按 Ctrl+C，再运行上述命令。窗口设置页的“浮窗不透明度”滑块可调；Cmd+Shift+O 显示/隐藏浮窗。DeepSeek 可由用户在本机点“保存并测试连接”自行验证；阿里目前仅完成配置保存。
+