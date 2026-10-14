# Saved Provider Profiles and Realtime Audio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 设置先展示已配置方案，可快速切换；添加/编辑进入详情，接入Qwen原生实时音频回答并保留双方转写、提示词、连续追问与暂停恢复。

**Architecture:** 方案存储公共配置，SecretVault按方案隔离密钥，旧配置迁移为现有方案。Qwen实时每音源独立连接、启用内置转写，关闭自动生成和自动打断；只有系统音频完成一轮时进入待答队列，麦克风仅补充上下文。回答沿用既有卡片、取消和诊断。设置入口先展示方案列表，活动会话锁定方案切换。

**Tech Stack:** Electron / React / TypeScript / ws / Vitest / Playwright。

---

### Task 1: 方案与配置
- src/main/settings/profiles.ts：原子存储、初次迁移、独立凭据标识。
- src/shared/ipc.ts、ipc-channels.ts、src/preload/index.ts：list/save/select方案接口，严格字段校验。
- src/main/settings/extras.ts：realtime配置持久化。
- tests/profiles.test.ts：密钥不会写入公共配置、迁移、选择持久化、无效配置。

### Task 2: 实时提供方
- src/main/providers/realtime/qwen.ts：连接配置、音频、转写、commit事件、文字请求/原生音频响应、取消、超时、断连。
- 服务器已实际确认 create_response=false / interrupt_response=false 和内置转写配置。必须测试自己发言不生成和原生音频先回答后转写的时序。
- tests/qwen-realtime.test.ts：本地WebSocket假服务的完整协议、旧响应忽略、断连取消、连续轮队列。
- src/main/session/controller.ts：可注入音频客户端，继续复用录音/暂停/重连。
- src/main/index.ts：用系统音频commit驱动Qwen请求、不经过独立ASR确认等待；取消后关闭自动，不漏排队问题；实时配置不要求独立ASR。

### Task 3: 设置入口
- src/renderer/src/pages/Profiles.tsx：两套方案卡片、当前状态、切换/编辑/添加。
- src/renderer/src/pages/Prepare.tsx：详细设置只由添加/编辑进入，实时模型显示地域/业务空间/阿里密钥，无独立ASR表单。
- src/renderer/src/main.tsx、theme.css：简约灰黑主题与返回列表。
- e2e/provider-profiles.spec.ts：默认列表、点击添加、保存、独立密钥、切换持久化、活动会话拒绝切换。

### Task 4: 验证与交付
- 先运行新增失败测试，再实现，运行npm test/typecheck/build及相关窗口/设置/模型/暂停/连续问题回归。
- 真实合成语音通过应用同款客户端，验证双方上下文、连续追问和暂停后重建，不采集私人音频。
- 打包固定签名，运行旧程序退出后覆盖同一路径；配置好Qwen方案并保留现有DeepSeek方案。
- 本次测速只证明简单短问题速度，不能声明复杂代码质量优于DeepSeek。新增真实接入不宣称完成全双工性能验证。
