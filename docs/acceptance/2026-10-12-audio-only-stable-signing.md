# 0.2.2 纯音频采集与稳定签名验收

## 交付

已覆盖原安装路径 `/Users/air/Documents/ChatGPT/REA/Realtime Assistant .app`，版本0.2.2。旧代码包备份在 `/private/tmp/realtime-assistant-plan/backup-before-audio-0.2.1.app`。用户数据路径和 app.setName 保持 local-realtime-assistant；原DeepSeek/ASR加密密钥在真实安装程序中可读，设置仍为鼠标穿透开启、不透明度0.64。启动只显示一个窗口，正常打开不创建采集。

## 修复

- 系统音频改为 macOS14.2+ Core Audio process tap，仅使用音频API；不创建 getDisplayMedia 或桌面视频流。原 capture.source IPC 已移除；desktopCapturer只保留显式截图问答。
- 音频在native中转为单声道Float32，主进程流式抗混叠重采样16k，隐藏采集renderer保留回音参考并编码PCM16走原ASR通道。
- 暂停、停止、窗口/renderer退出均停止native；继续保留设备配置并重建。启动错误只拒绝启动，运行后异常进入可重试暂停。恢复超时同时使renderer指令失效并等待native/core暂停；指令UUID与窗口身份检查隔离迟到回复和旧窗口退出事件。
- 日志保留静态采集失败阶段和数字OSStatus，不写密钥、转写、提示词、音频或设备名称。
- 本地主程序与原生辅助程序使用同一个长期专用证书、固定identifier和证书锚点，不再使用实际ad-hoc签名。electron-builder的identity:"-"仅用于分发到强制自定义签名hook；hook在证书缺失时失败，不能回退临时签名。

## 实际签名验证

分别打包0.2.2与仅用于验证的0.2.3（后者未安装、未启动）。代码CDHash不同，主程序DR相同；system-audio和option-modifier的DR分别相同。两包deep/strict完整性验证及指定证书anchor校验通过。移动签名材料后另用临时native副本验证签名仍可用。

创建专用钥匙串时临时加入搜索列表，随后立即恢复原列表；默认钥匙串不变；未修改任何系统/用户证书信任、未重置TCC。OpenSSL3的默认PKCS12导入失败后，复用同一原密钥与证书改为兼容的PBE-SHA1-3DES、SHA1 MAC、高迭代导出；未重新生成签名身份。

签名资料长期保存在 `/Users/air/Documents/ChatGPT/REA/.local-signing`，目录0700、文件0600，源码worktree通过被Git忽略的symlink访问。密码只经输入管道传入，未进入命令参数、聊天或日志。不要删除/重新初始化这个目录，否则证书身份会改变。

## 自动验证

- 完整类型检查通过。
- 24个测试文件、115项单元测试通过。
- 24项Electron E2E全套通过；随后扩展的采集E2E额外验证helper意外退出、恢复超时→暂停→继续→停止，无残留采集且会话不变；迟到running按独立指令ID忽略。恢复超时回归在修复前明确失败（opened4/stopped3），修复后通过。
- native --self-test通过（有限队列、溢出、Float32编码、阻塞stdout退出）。
- 打包启动/Option helper/拖动端点/穿透恢复通过。
- 旧实现先被回归测试击中：在禁止getSources的情况下session.start调用capture.source失败；修复后实际Capture页面通过，不枚举屏幕、不创建视频流。

## 真实安装程序采集

应用通过LaunchServices从原安装路径启动，避免临时Electron测试的responsible app归属Codex问题。只在获准本机测试时启用临时loopback调试端口，完成后关闭并正常重启。

1. 屏幕权限为denied；纯系统音频启动ready成功，静音测试2032ms无PCM。
2. 同样屏幕权限denied；再次启动纯系统音频并播放350ms合成音，719ms后停止，收到14帧、26880个原生采样点、峰值0.030000001。

两次采集总时长约2.751s，处于此前获准5秒测试的剩余保守3秒预算内。没有麦克风采集、上传或录音保存；仅保存统计JSON。说明该机不授予屏幕录制仍可采到系统音频。

## 限制

这不是绕过系统隐私许可：纯系统音频仍由macOS的系统音频录制授权控制；显式截图仍需屏幕录制。首次更换到长期证书可能需要一次新批准。验证DR稳定不等于已完成未来每次更新的逐项TCC保留测试，也不保证系统永远不会重新提示。证书变更、用户撤销、系统策略都可能使授权改变。

本轮未再采真实麦克风或把系统音频发送ASR；新路径硬件PCM和本地模拟ASR/E2E分别通过，真实会议中双方识别与回音仍应现场观察。采样率/设备在会话中切换可能需暂停后继续；native可丢弃拥塞帧，停止舍弃滤波窗口尾部。签名用于本机稳定身份，没有Apple Developer ID分发/公证资格。

正式打包入口已增加预检：在builder运行之前拒绝自动导入证书的环境或配置、PR跳过签名路径和CLI签名覆盖；打包后对主程序、辅助程序和所有Mach-O再次验签。一次与签名构建并行的E2E批跑在model-flow超时；该项随后单独复测通过，停止并行建包后，最终24项E2E批跑全部通过（54.0秒）；没有跳过或删去用例。
