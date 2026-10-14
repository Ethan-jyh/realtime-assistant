# 0.2.5 正式包启动修复

用户截图是原路径正式0.2.4，PID7927，SIGTRAP，启动约3秒退出。系统日志明确：electron_main_delegate_mac.mm:66 FATAL Unable to find helper app。受控直接启动stderr同样复现，且未写入app.started。

根因：0.2.4 extendInfo覆盖CFBundleName为中文显示名，Electron据内部包名查找辅助.app，但打包产物仍以productName Realtime Assistant命名辅助程序。此前开发Electron E2E、签名验证不能验证该正式包名称约束，造成交付缺陷。

修复：保留CFBundleName与productName一致，中文名称只用于CFBundleDisplayName、页面和菜单提示。appId、原路径、safeStorage、固定证书及用户数据不变。package-mac预检拒绝不匹配的CFBundleName覆盖，回归先失败后通过。

125单元/26文件通过，类型检查和构建通过。0.2.5固定签名严格验证通过；直接覆盖原路径，备份0.2.4到private/tmp。原路径经LaunchServices启动的实际安装包验证：PID13454、packaged true、version0.2.5、Dock可见、唯一可见窗口；model/asr key retained true，屏幕granted，不透明度0.87，穿透false均保留。最小化true，activate后restored true，随后正常退出。

诊断实例关闭后，不带调试参数重新打开：PID13615、唯一主进程，8秒后仍在，app.started版本/进程一致。测试未启动录音、未截图、未上传模型内容。仅验证本次明确启动根因，不宣称消除所有可能的Electron原生崩溃。
