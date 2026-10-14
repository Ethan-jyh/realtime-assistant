# 0.2.4 穿透与桌面菜单验收

用户要求：反引号单键切换穿透，消除切换消失/闪动；显示名腾讯会议私有部署；顶部菜单只有显示、隐藏、设置、退出。

实现：单键 ` 与原 ⌘⇧I；按住 Option 临时操作仍支持。运行期间全局快捷键占用反引号输入；注册失败提示原组合键并记录 enabled。鼠标策略只写 setIgnoreMouseEvents，不动态 setFocusable/blur/show/hide/load。恢复窗口仍按穿透状态 showInactive。检测器保留存活实例；异常退出后重新开启可恢复。

CFBundleDisplayName、CFBundleName、页面与状态图标提示更新；appId、可执行文件、safeStorage 名称、用户数据路径、固定证书及原安装路径保留，防止配置/授权迁移。原文件名仍 Realtime Assistant .app。

验证：类型检查通过；26 文件124单元测试通过。完整单实例界面回归原有25场景通过；新增穿透回归最初把重复原生 show 通知算作窗口重新打开而失败，已改为追踪原生窗口操作调用及 hide/closed/加载事件。此后鼠标穿透/恢复/快捷键和桌面菜单3场景通过。连续切换窗口可见、原生句柄不变，show/showInactive/hide/close/destroy/loadURL/loadFile/blur/setFocusable均无调用。OS 注册成功，快捷键处理链实际切换状态；没有模拟物理按键。

开发测试一次仅运行一个Electron实例（workers:1）。最初并行批次21通过5超时，用户截图对应Electron测试PID94939原生崩溃，堆栈位于AppKit becomeKeyWindow/激活通知路径；无法单凭符号化不完整的堆栈判断具体Electron根因，不能宣称已修复所有原生崩溃。失败5场景单独串行重测通过；之后一次完整单实例26场景通过（在检测器恢复和固定焦点最终调整之前）。测试实例退出后只保留用户正式程序PID89442；正式程序仍采集，等待用户退出后覆盖。

本次未采麦克风/系统音频，未向真实模型上传数据。截图E2E使用已存在的本机测试接口，非DeepSeek。
