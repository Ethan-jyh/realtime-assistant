# 0.2.3 桌面入口验收

最终交付原路径：/Users/air/Documents/ChatGPT/REA/Realtime Assistant .app。版本0.2.3；旧0.2.2代码包备份/private/tmp/realtime-assistant-plan/backup-before-desktop-0.2.2.app。未重新生成证书或改变appId。

## 最终行为

顶部使用企业微信单色线条模板图标，18 DIP，透明背景1x/2x资源，macOS自动适配深浅色；菜单可显示助手、隐藏窗口、设置、暂停/继续录音、切换穿透、打开日志及退出。标题仍是Realtime Assistant。

底部Dock重新显示，彩色图标直接复制本机企业微信AppIconGov.icns并放入应用CFBundleIconFile。打包模式不晚调用dock.setIcon，因此程序不会主动先显示一张图再换图。安装后仅刷新该应用的LaunchServices注册，未重启整个Dock或删除系统缓存。

首页、API设置、浮窗均有最小化和X完全退出。最小化保留后台；Dock激活、菜单显示及重新打开已有实例恢复最近窗口，取消最小化。X通过app.quit→before-quit停止采集、封装当前会话、保存并刷新日志后退出；菜单的隐藏是单独动作。

## 验证证据

- 类型检查、123个单元测试通过。
- 最终25项Electron界面回归全部通过（56.0秒）。初次批跑按钮测试卡在隐藏prepare页截图；日志和已保存配置确认前序动作正常，测试改为先显示prepare再截图，与真实可见窗口操作一致，未跳过断言。此前独立截图流程超时后单项复测通过，最终批跑也通过。
- 新desktop-entry回归真实执行菜单隐藏/显示/设置、Dock activate、最小化/恢复、X退出进程，并检查会话历史state stopped。
- Tray单元覆盖动态状态、重复点击、异步异常、安全销毁；原生setContextMenu为macOS点击菜单入口。
- 正式package wrapper前置阻止自动导证书，后置主程序/helper/all Mach-O固定证书验签通过。新旧程序DR完全相同。ICNS与本机企业微信原文件逐字节相同。
- 实际安装程序通过LaunchServices启动：pid88062/version0.2.3/packaged true，Dock可见，只有1个可见窗口，屏幕权限granted。原模型/ASR密钥可读取，opacity0.87、mouseThrough false均保留；各1个最小化和完全退出按钮。
- 本机直接验收最小化动画完成后isMinimized true，activate后可见且非最小化；quit_app正常退出并写app.quitting。没有启动录音、发送模型请求或上传截图。

Playwright临时profile的包探针有一次在ready-to-show前读取可见窗口数而失败、一次等待调试predicate超时；不将其视为成功证据。最终验证改用实际原路径进程直接诊断，并等待原生最小化动画，所有上述实际安装断言通过。临时端口最终关闭，应用恢复普通启动。

## 保留边界

不保证macOS本身永不重新询问权限。本轮已确认屏幕授权从0.2.2保留到同证书0.2.3。完整菜单的真实鼠标展开观感及系统冷启动首帧图标仍由用户现场确认；原生菜单构造、回调和图标安装均已验证。
