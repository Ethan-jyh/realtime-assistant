# 桌面入口与关闭行为

用户最终要求：macOS顶部使用企业微信风格单色菜单栏图标，底部Dock显示彩色企业微信应用图标；界面提供最小化和X完全退出。此前隐藏Dock要求被本轮显式要求覆盖。程序名称、appId、签名证书、API配置目录保持原身份。

关闭恢复根因：activate按BrowserWindow.getAllWindows().length判断是否需要显示；隐藏的overlay/capture可使长度非零，从而不会显示界面。WindowManager新增restoreWindow，恢复最近的prepare/overlay并取消最小化；activate与second-instance直接恢复。

DesktopMenu持有Tray，原生setContextMenu提供下拉菜单。菜单含显示助手、隐藏窗口、设置、暂停/继续录音、鼠标穿透、打开日志、退出。状态从CoreSession/MouseThrough读取，暂停只在有效音频会话启用，异步操作pending时禁用重复动作，错误写静态诊断。

首页、API设置和辅助浮窗均提供−最小化及×完全退出。X调用quit_app→app.quit，原before-quit等待停止采集、封装会话、保存记录、刷新日志再退出；不会把X解释为只隐藏。菜单的隐藏窗口是独立动作。

图标采用本机企业微信已安装素材：Dock复制AppIconGov.icns，菜单从res/res.rcc中提取wecom_20.svg并渲染透明1x/2x PNG，nativeImage启用template以自动适配深浅主题。程序包使用启动时CFBundleIconFile，不在packaged模式下晚调用dock.setIcon；开发环境仍可使用动态图标。

验证：菜单单元覆盖状态/重复操作/异步错误/安全销毁；Electron回归真实隐藏/恢复/最小化/激活/退出与会话历史落盘；packaged验签及程序图标字节核对。更新继续覆盖原路径，使用固定证书保护已绑定的系统授权。
