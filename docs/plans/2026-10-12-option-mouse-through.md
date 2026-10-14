# Option 鼠标穿透与不透明度修复

用户已选择 Option（⌥）。辅助浮窗默认穿透；按住 Option 临时交互，松开恢复。设置页与准备页始终正常点击。浮窗开关、设置开关与 ⌘⇧I 可以关闭穿透，输入文字时使用此方式。

采用 Electron 原生 setIgnoreMouseEvents。macOS 独立 Swift 小程序每 30ms 查询一次 Option 修饰标志，只输出 0/1 与每秒心跳；不监听按键内容、不读取文本。主进程接收标志并更新鼠标忽略与可聚焦状态，不主动在按键按下时抢焦点。3 秒没有心跳或小程序退出时恢复正常点击。退出时关闭小程序。状态改变记录诊断元数据。

不透明度根因：原代码仅对辅助浮窗 setOpacity，而打开设置后浮窗隐藏；当前可见准备/设置窗口仍是 1。修复：两个窗口即时同步，创建窗口也恢复保存值。滑块明确写“窗口不透明度”，值变更记录日志。

任务：
- [x] 写穿透状态与失效恢复单元测试，再实现 MouseThrough。
- [x] 实现原生修饰键查询和编译/打包资源。
- [x] 接入主进程、开关、全局快捷键和拖动中松键收尾。
- [x] 写可见设置窗口不透明度失败测试，再同步两个窗口。
- [x] 验证模拟 Option 下原生窗口属性、进程失效释放和设置保存。
- [x] 全量测试、签名打包、真实小程序资源可用性与交付（0.2.0）。

官方接口参考：[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[Apple flagsState](https://developer.apple.com/documentation/coregraphics/cgeventsource/flagsstate(_:))。实机鼠标按下穿透不由模拟状态测试替代；原生 UI 自动化不可用，不重复触发长时间超时。
