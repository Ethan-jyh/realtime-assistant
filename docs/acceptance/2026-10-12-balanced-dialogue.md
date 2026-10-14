# 0.2.6 平衡模式验收

用户已选平衡并授权实施、测试；新增明确更名企业微信私有版与启动图标要求。

## 实现

非丢失队列保留final句段ID、按源/epoch去重，900ms收集，无5秒阅读冷却。partial阻止过早请求；暂停与ASR换epoch清除失效partial而保留final。忙时保存后续全部问题，完成后提交所有待答内容。明确补充纠正短语在收集后恢复原任务并加入新条件、取消过时生成；取消卡片保留。语义分类采用保守规则，不宣称所有自然语言均能准确合并。

完整双方确认转写+已完成assistant历史+本轮待答任务；取消回答不作事实。普通先短结论，代码题思路/复杂度/代码。官方DeepSeek平衡普通关闭thinking，明确编程任务enabled+low，可选deep模式；兼容其他API不注入厂商字段。

requestId卡片追加、Markdown安全渲染、序号防迟到/重复；重载缓冲事件与snapshot sequence协调。近底部跟随，阅读历史保持位置，可跳最新。模型失败保留待答并关闭auto，用户修复连接后再开启，避免错误循环；vault失败受generation所有权保护。

日志新加batch/queueWaitMs/turn、脱敏segmentKeys、headers/reasoning首事件/正文计时与thinkingEnabled；不记录正文、提示词、音频、密钥或思考内容。

## 验证

类型检查通过；28文件161单元通过；最终完整单实例界面34/34通过（1.4m）。新增端到端覆盖持续partial延后、A/B同时提交、生成期间C/D不丢且无冷却、补充纠正、暂停中半句话、401保留与恢复、旧vault迟到失败、新vault失败恢复、原生故障暂停、ASR自动重连。答卡scroll与重载序号都有回归。

TDD记录：queue/上下文/参数/卡片/策略各自红绿；实际持续说话提前请求、暂停残留、原生自动暂停漏任务、重连残留都先复现后通过。首次完整回归30通过4失败：capture和Markdown新增卡片造成旧定位歧义；model-flow旧替换式断言需改为卡片隔离；save-port单次少末尾字符，隔离重跑原断言通过。修正前3个测试断言后最终34全部通过，没有跳过测试。未以一次短跑宣称原生崩溃全部修复。

## 名称、签名和安装

productName改企业微信私有版，CFBundleName/Executable/helper一致；Chinese显示名不再独立破坏helper查找。CFBundleIconFile enterprise-private.icns，字节匹配本机企业微信AppIconGov.icns。布局预检校验主exe、两类helper、icon。实际0.2.5内部仍Realtime Assistant，只有显示名Tencent，因此此前改名未覆盖系统内部名称；旧图标延迟的具体OS缓存行为未逐帧验证，当前采用新产品/文件/图标资源名和该应用LS注册刷新，无正式版启动后切图标代码、无全局Dock缓存重置。

同appId local.realtime.assistant和固定证书保留。用户结束并保存/退出后，以 `/Users/air/Documents/ChatGPT/REA/企业微信私有版.app` 替换旧文件；旧0.2.5仅backup在private/tmp，不留第二个正常程序。正式路径LaunchServices启动PID44346 packaged true/version0.2.6，Dock可见、唯一窗口、grave快捷键注册成功，屏幕granted、API两钥匙保留、opacity0.87/mouseThroughfalse保留。实际最小化true/恢复true，正常退出诊断实例。

不带调试参数重开PID44550，唯一主进程、8秒后存活，启动日志版本匹配；9336/9337已关闭。测试采用本机合成服务；未采集硬件、未发送真实API。外部模型速度/回答覆盖质量未做新真实对照，不能承诺固定秒数或永不漏答。
