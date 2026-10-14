# Option 拖动修复验收

## 已确认

- 旧代码每次松开 Option 都尝试 blur；Electron macOS 原生代码明确说明 Focus(false) 会把窗口向后排序。新版的被动窗口策略在穿透可用时保持非焦点窗口，Option 只切换鼠标忽略。
- 拖动结束先 flush 最新坐标，再等待唯一在途 IPC 完成，随后释放 drag token。早松 Option 不再中断手势或取消末帧。
- UUID 区分旧手势；关闭/重建窗口后旧位置请求不移动新窗口。拖动停止通知丢失时，30 秒租期保证不会永久锁住穿透。
- 移动只更新位置；重复坐标不重复提交；慢 IPC 等待时只保留最新端点，不堆积中间位置。
- 不变的 Markdown 回答 memo，避免计时器/穿透状态变化时反复解析。

## 测试边界

状态与队列单元测试通过。E2E 模拟 150 次 pointermove，验证最后坐标和原尺寸，原生 setPosition 不超过 3 次，Option/拖动期间没有额外 setFocusable/blur 调用。用户实际拖动的视觉观感尚需现场复核；没有调用之前长期超时的 CUA。

全量初次运行发现测试在 close context 后立即重新 launch 时超时；轨迹显示回答和取消已完成，阻塞在新 Electron 启动。等待进程 exit 后仍遇到自动化连接超时；将原生重启用例放入独立 worker 后，问答重启通过，原先复用 worker 的不透明度重启出现同类问题。两个重启检查均改为独立 worker，避免累积调试连接状态。产品问答逻辑未改变。

最终类型检查通过，82 项单元测试、24 项 E2E 全部通过。原生 Electron 调试连接在长时间复用 worker 后启动阻塞，现各 spec 使用独立 worker，完整串行运行 24 项通过；重启检查仍在各自测试内真实执行，未跳过。

按用户要求覆盖当前原程序 `/Users/air/Documents/ChatGPT/REA/Realtime Assistant .app`，只在退出后替换。配置和授权不主动重置。当前为本机 ad-hoc 签名，签名变化可能仍要求 macOS 重新确认权限；不能保证保持路径就免授权。

交付程序 0.2.1 已按原路径覆盖，完整包签名验证通过。隔离成品检查返回 focusable=false、dragEndpoint=true、passThroughRestored=true、nativeModifier=true。回滚包保存在本机临时目录，未改动用户数据。实际接收端/视觉效果待使用者复核。
