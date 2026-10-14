# Option 拖动平滑修复

问题：拖动结束后闪动，移动感觉不流畅。

证据：旧代码每次松开 Option 都 setFocusable(false) 并调用 blur。Electron 的 NativeWindowMac::SetFocusable 注释明确指出 Focus(false) 会把窗口置后。旧 hook 的 pointerup 只预约下一帧，穿透回调可能取消末帧。每帧发起 invoke，没有限制正在等待的移动数量。

方案：穿透功能开启且检测可用时，浮窗始终不抢焦点，Option 只改变鼠标忽略；文字输入仍先关闭穿透。拖动 begin/end 带独立 UUID，结束时位置先落定再解锁穿透；旧手势不影响新窗口。等待中的移动合并为最新位置，最多一个 IPC 在途；不重复移动相同位置，移动不改窗口尺寸。Markdown 内容不变时跳过解析。

验收：状态测试覆盖提前松键、结束、30 秒失联拖动和检测失败；队列覆盖慢 IPC、最后端点、重复坐标及错误恢复。E2E 将 150 次移动合并，检查原生 focusable/blur 调用数量不因 Option/拖动改变，最终窗口坐标与尺寸准确。真实鼠标视觉闪动仍需使用者复核，不以模拟事件代替视觉结果。

更新：用户已要求覆盖原程序。当前路径为 `/Users/air/Documents/ChatGPT/REA/Realtime Assistant .app`；必须确认应用退出后再替换，不重置现有权限。

原生代码参考：https://github.com/electron/electron/blob/main/shell/browser/native_window_mac.mm
