# 开发环境与工具链选型记录

## 1. 运行与工具链版本

- **Node.js**: `v24.11.1`
- **npm**: `11.6.2`
- **Electron**: `44.7.0`（engines: `node >= 22.12.0`）
- **electron-vite**: `5.0.0`（engines: `node ^20.19.0 || >=22.12.0`，peer: `vite ^5.0.0 || ^6.0.0 || ^7.0.0`）
- **Vite**: `7.3.7`（精确兼容 electron-vite 5 与 vitest 5）
- **Vitest**: `5.0.3`（engines: `node ^22.12.0 || ^24.0.0 || >=26.0.0`，peer: `vite ^6.4.0 || ^7.0.0 || ^8.0.0`）
- **React / React-DOM**: `19.3.0`
- **@vitejs/plugin-react**: `5.2.0`（peer: `vite ^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0`）
- 会话历史当前使用原子写入 JSON；未使用的 SQLite 原生依赖已移除，避免打包时无用的 ABI 重编译。

## 2. 选型兼容理由

1. 当前系统 Node 环境为 `v24.11.1`。
2. `electron-vite@5.0.0` 约束其 peer 依赖 Vite 为 `^5.0.0 || ^6.0.0 || ^7.0.0`；若直接使用默认 latest Vite 8 会导致 npm 依赖冲突（ERESOLVE）。
3. 选定 `vite@7.3.7` 及 `@vitejs/plugin-react@5.2.0`，使 Vite、electron-vite、vitest 与 React 19 达成完全兼容的依赖图。
4. 全量依赖版本锁定在 `package-lock.json` 中，确保重现性。

## macOS 打包与日志

`npm run package:dir` 生成 `release/mac-arm64/Realtime Assistant.app`，使用已安装的 Electron，不依赖开发服务器。配置为本机 ad-hoc 签名的未公证构建。独立程序只包含构建结果和运行依赖，不包含密钥、会话数据或诊断脚本。

默认日志：`~/Library/Application Support/local-realtime-assistant/logs/diagnostics.log`。每个文件最多 2 MiB，保留当前文件及 `.1`、`.2`，文件权限 0600；按顺序串行追加，正常退出前 flush。每次启动写入版本、PID和时间。主进程异常保留编译代码位置，不保留异常正文或完整用户路径。

可从 API 配置底部打开日志目录。排查时保留全部三个日志文件和问题发生时间。`renderer.load_start` / `renderer.load_end` 表示页面真正加载；`answer.started` / `answer.first_output` / `answer.finished` 表示回答切换。`capture.pause_requested`、`capture.rebuild`、`capture.status`、`capture.settings`、`capture.echo` 用于追踪音频。日志无密钥、提示词、转写正文、录音。

原生修饰键查询：`native/option-modifier.swift` 只查询 Option 标志，输出 0/1，无按键监听、键码、文本或录音。`npm run build/dev` 调用 `scripts/build-native.cjs`，开发构建需要 Xcode Command Line Tools；成品包含 arm64 小程序，用户无须 Swift 工具链。`extraResources` 放入包的 Resources/option-modifier。心跳每秒一次，主进程 3 秒无心跳即恢复可点击，正常退出停止子进程。

新增日志：`window.mouse_mode` 只记录 enabled/held/available/ignoring，`window.opacity` 记录不透明度数值。
