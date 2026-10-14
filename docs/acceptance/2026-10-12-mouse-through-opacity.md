# Option 穿透与不透明度验收（0.2.0）

- 用户选择 Option（⌥）。仅辅助浮窗默认穿透；按住 Option 临时接收鼠标，松开恢复。准备页与设置页不穿透。
- 浮窗/设置开关与 ⌘⇧I 可关闭；输入文字时建议先关闭，避免 Option 改变字符输入。
- 原生小程序仅查询 Option 标志，未采集麦克风、键盘内容或屏幕。每秒心跳，3 秒失联或退出恢复可点击；应用退出结束子进程。
- 模拟 Option 状态的 E2E 验证真实 BrowserWindow 的 setIgnoreMouseEvents 与 focusable 政策，故障释放和设置保存。状态单元测试也覆盖超时。
- 不透明度根因已复现：设置页仍为1，只有隐藏的浮窗变为0.4。现两个窗口即时同步，创建窗口恢复保存值；E2E 及成品重启验证通过。
- 类型检查、78 项单元测试、24 项 E2E 全部通过。
- 成品真实原生小程序可用性通过：nativeModifierAvailable=true；visibleOpacity=0.4；mousePreferenceRestored=true；配置与退出日志重启恢复通过。此处不是模拟小程序。
- 完整包 codesign --verify --deep --strict 通过；本机 ad-hoc 签名，无公开公证。
- 原生鼠标按下/透传到下层窗口的实际 UI 操作尚未自动验证；未重复使用此前长时间超时的 CUA 工具。

交付：`/Users/air/Documents/ChatGPT/REA/Realtime Assistant 新版.app`。先 ⌘Q 退出旧版再启动；原版保留，不覆盖运行中的包。沿用原用户数据和密钥目录。

日志增加 window.mouse_mode 的布尔状态与 window.opacity 数值，没有键盘内容。
