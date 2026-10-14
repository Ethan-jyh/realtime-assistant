# 自有 API 实时助手 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 macOS 上独立运行、连接自有模型与独立 ASR 的实时助手，完成浮窗、音频、回答和本地保存闭环。

**Architecture:** Electron 主进程管理会话、服务连接、密钥和本地存储；React 页面通过受限 IPC 展示状态。受控采集页面通过 AudioWorklet 和有界 MessagePort 通道传递分来源 PCM；ASR 与模型分别转换为统一领域事件。录音写入、网络发送和界面更新独立调度，停止流程明确取消和收尾。

**Tech Stack:** Electron、TypeScript、React、electron-vite、Vitest、Playwright Electron、Zod、ws、better-sqlite3、mammoth、pdfjs-dist、electron-builder；Node/npm 工具链。

---

## 使用本计划

这是设计的开发拆解，尚未执行。用户“拆解成 plan”授权进入计划阶段，不表示已选择执行方式。设计基线为 [2026-10-11 设计文档](../superpowers/specs/2026-10-11-local-realtime-assistant-design.md)，提交 `c1e72a8`。

工作树：`/Users/air/.codex/worktrees/realtime-assistant-plan/REA`。本计划中所有项目路径都相对此目录；执行所有 npm/git 命令前先进入此目录。原证据位于 `/Users/air/Documents/ChatGPT/REA/realtime-copilot-analysis/`，它是未跟踪资料，未复制进工作树。设计文档内的分析报告相对链接在工作树中不成立；核查证据时使用上述原目录，不把发布包或分析压缩包加入新工程。

当前工程只有设计文档，没有应用源码、package.json、依赖或测试环境。Task 1 之前不能运行 npm 测试；以下测试命令都是未来执行命令，并非当前通过的结果。使用 @superpowers:test-driven-development 处理有行为的模块；使用 @superpowers:verification-before-completion 完成阶段验收。失败时使用 @superpowers:systematic-debugging。每个编号步骤是一项动作，尽量控制在 2–5 分钟；长时手工验收单列，不算一次编码动作。

### 范围与顺序

| 阶段 | 任务 | 输出 / 验收门槛 |
|---|---|---|
| A：独立文本与窗口 | 1–9 | 自有模型回答；受限 IPC；浮窗失焦可见；尽早完成腾讯会议接收端测试 |
| B：音频和真实 ASR | 10–16 | 双来源 PCM、有限重连、转写归一化、选定供应商的实网链路 |
| C：会话与本地能力 | 17–23 | 上下文、停止收尾、历史、录音、资料导入和完整页面 |
| D：交付验证 | 24–25 | 安装包、权限、异常恢复、60 分钟运行及环境化共享验收 |

Task 16 依赖用户选定 ASR 服务并提供本地配置；其他模块可使用 mock 开发。Task 24 的真实模型验收依赖用户配置模型端点和凭据。凭据不进入本计划、仓库或测试 fixture。缺少外部条件时继续独立任务，阶段 B/D 标为“等待真实接入”，不能标记首版完成。

### 工具链与实现约定

- Task 1 执行时查询 Electron、electron-vite、React、Vitest 的稳定版本及 engines，选择共同兼容的 Node LTS；精确锁定到 package-lock.json。这里不把未经实际安装的版本号伪装成已兼容。
- 主进程 HTTP 使用 fetch，设置 `redirect: 'error'`；模型请求不自动跟随重定向。WS 客户端只在主进程使用。
- 新应用名称为 `Local Realtime Assistant`，bundle ID 为 `local.realtime.assistant`；用户数据与原应用分离。开发包与发行包保持明确名称。
- 最小实现代码用于每项核心契约，不替代该任务列出的平台接线和完整错误测试。Task 11 的重采样和 Task 16 的供应商协议需要在各自实现前补齐局部代码与测试细分；不能把计数函数或 mock 当完整实现。测试应覆盖可观察行为，不只断言函数存在。
- 所有 task 单独提交自己的文件；提交前 `git diff --cached --name-only`，不可使用 `git add .`。不要提交密钥、用户资料、录音或原发布包。

### 已核对的官方资料与平台约束

- [electron-vite 起步](https://electron-vite.org/guide/)：构建主进程、preload、renderer；执行时再核对版本及 Node engines。
- [OpenAI Chat 流式事件](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)：文本在 choices/delta/content；空 choices 不应抛错。
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows)：内容保护启用不等于所有 macOS 采集方式都能排除；接收端需实测。
- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)：系统音频行为受版本和 macOS 权限影响；打包需要核对 NSAudioCaptureUsageDescription，存在获得音轨却没有音频的情况。
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：macOS 由钥匙串保护加密密钥。实现细化为本地密文 vault + 系统钥匙串保护，而非把 API Key 原文写入数据库；不可用则仅内存。


### Task 1: 建立独立工程与测试工具链

**Files:**
- Create: `package.json`, `package-lock.json`, `.gitignore`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`
- Create: `tests/smoke.test.ts`, `docs/development.md`

**Step 1:** 运行 `node --version`、`npm --version`、`npm view electron version engines --json`、`npm view electron-vite version engines --json`、`npm view vitest version engines --json`，将选定版本及兼容理由记录到 docs/development.md。没有共同兼容工具链时先解决工具链，不跳过 engines 错误。

**Step 2:** 执行 `npm init -y`，查询 `npm view react version engines --json`，记录版本后安装：`npm install --save-exact react react-dom zod ws better-sqlite3 mammoth pdfjs-dist`、`npm install -D --save-exact electron electron-vite vite typescript vitest @playwright/test electron-builder @vitejs/plugin-react @types/node @types/react @types/react-dom @types/ws @types/better-sqlite3`；以上使用执行时注册表解析到的稳定版本，随后以 lockfile 固定。自行编写最小 electron-vite 三进程入口，不把脚手架输出覆盖分析目录。安装并锁定 React/Zod/ws/better-sqlite3/mammoth/pdfjs-dist 与开发依赖 Electron/electron-vite/Vite/TypeScript/Vitest/Playwright/electron-builder；将 SQLite 原生依赖纳入 electron-builder install-app-deps。

**Step 3:** package.json 设置以下脚本，安装时配置相应入口和 TS 项目，不复制注释作为 JSON：

```json
{
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "package:dir": "npm run build && electron-builder --dir --mac --arm64",
  "package:mac": "npm run build && electron-builder --mac --arm64",
  "postinstall": "electron-builder install-app-deps"
}
```

**Step 4:** vitest.config.ts 只包含 `tests/**/*.test.ts`，Electron GUI 测试放 `e2e/`；tsconfig 开启 strict。加入 .gitignore：node_modules、out、dist、coverage、test-results、playwright-report、.env*、*.sqlite*、*.pcm、*.wav。

**Step 5:** 写 src/main/index.ts 的 ready/退出最小入口，加载本地 React 页面；preload 暂不暴露 API。写下面的环境测试并运行 `npm test -- tests/smoke.test.ts`：

```ts
import { expect, test } from 'vitest';
test('测试运行器支持取消请求所需环境', () => {
  const controller = new AbortController();
  controller.abort();
  expect(controller.signal.aborted).toBe(true);
  expect(typeof TextDecoder).toBe('function');
});
```

**Step 6:** `npm run typecheck`、`npm run build`、`npm run dev`。Expected: 前两项退出 0，本机出现空白独立应用窗口并可退出。烟雾测试只验证环境，不作为产品验收。

**Step 7:** `git add -- package.json package-lock.json .gitignore electron.vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json src/main/index.ts src/preload/index.ts src/renderer/index.html src/renderer/src/main.tsx tests/smoke.test.ts docs/development.md`；检查 staged；`git commit -m "chore: bootstrap independent electron application"`。


### Task 2: 领域身份与转写修订

**依赖：** Task 1

**Files:**
- Create/Modify: `src/shared/contracts.ts`
- Create/Modify: `src/main/transcript/store.ts`
- Test: `tests/transcript-store.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { putSegment } from '../src/main/transcript/store';
test('修订替换同片段，正常重复句保留', () => {
  const rows = new Map();
  const base = { sourceId:'microphone', streamEpoch:1, revision:0, isFinal:false };
  putSegment(rows, {...base, segmentId:'a', text:'数'});
  putSegment(rows, {...base, segmentId:'a', revision:1, text:'数组', isFinal:true});
  putSegment(rows, {...base, segmentId:'b', text:'数组', isFinal:true});
  expect([...rows.values()].map(x => x.text)).toEqual(['数组','数组']);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/transcript-store.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export interface Segment {
  sourceId: 'microphone' | 'system'; streamEpoch: number;
  segmentId: string; revision: number; text: string; isFinal: boolean;
}
export function putSegment(rows: Map<string, Segment>, next: Segment): void {
  const key = JSON.stringify([next.sourceId,next.streamEpoch,next.segmentId]);
  const old = rows.get(key);
  if (old && (next.revision <= old.revision || old.isFinal)) return;
  rows.set(key, {...next});
}
```

**Step 4: 在 contracts.ts 声明 SessionIdentity、PcmFrame、TranscriptEvent、AnswerEvent、GapEvent；文本与元数据分离，时间允许 null，完成状态采用判别联合。**

**Step 5: 补充不同 source/epoch、倒序修订、重复 final 和已 final 不降级测试。**

**Step 6: 验证通过**

Run: `npm test -- tests/transcript-store.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：适配器收到 final 后修改内容视为协议异常；如果供应商明确支持 final 修订，Task 16 必须修订这个契约及测试，不能绕过存储规则。

**Step 7: 提交**

```bash
git add -- src/shared/contracts.ts src/main/transcript/store.ts tests/transcript-store.test.ts
git diff --cached --name-only
git commit -m "feat: implement 领域身份与转写修订"
```


### Task 3: 受限 IPC 与身份校验

**Files:**
- Create/Modify: `src/main/ipc/register.ts`
- Create/Modify: `src/shared/ipc.ts`
- Create/Modify: `src/preload/index.ts`
- Test: `tests/ipc.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { authorizeSender } from '../src/main/ipc/register';
test('未知页面不能使用主进程能力', () => {
  expect(() => authorizeSender(9,new Set([1,2]))).toThrow('UNTRUSTED_SENDER');
  expect(() => authorizeSender(1,new Set([1,2]))).not.toThrow();
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/ipc.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function authorizeSender(id: number, allowed: Set<number>): void {
  if (!allowed.has(id)) throw new Error('UNTRUSTED_SENDER');
}
```

**Step 4: 定义 settings.save、provider.test、session.start/stop、answer.ask/cancel、window.command、history.list/delete/export、document.pick/confirm 白名单；Zod 校验每个 payload。**

**Step 5: 在真实 ipcMain handler 验证 webContents ID、主 frame 及本地页面 URL；preload 使用 contextBridge 暴露具名方法和返回 unsubscribe 的事件订阅，不暴露通用 invoke。**

**Step 6: 补充未知命令、畸形 payload、子 frame、页面导航和密钥回传检查；在主窗口启用 contextIsolation/sandbox、禁用 nodeIntegration 和远程导航。**

**Step 7: 验证通过**

Run: `npm test -- tests/ipc.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：端到端测试不能从 window 获取 require/process、任意 FS 或 fetch 代理；密钥提交后 UI 只收到 configured 状态。

**Step 8: 提交**

```bash
git add -- src/main/ipc/register.ts src/shared/ipc.ts src/preload/index.ts tests/ipc.test.ts
git diff --cached --name-only
git commit -m "feat: implement 受限 IPC 与身份校验"
```


### Task 4: 模型配置与密钥 vault

**Files:**
- Create/Modify: `src/main/settings/model.ts`
- Create/Modify: `src/main/settings/vault.ts`
- Test: `tests/settings.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { completionUrl } from '../src/main/settings/model';
test('API 前缀不重复补 v1，远程 HTTP 拒绝', () => {
  expect(completionUrl('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
  expect(() => completionUrl('http://example.com/v1')).toThrow('HTTPS_REQUIRED');
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/settings.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function completionUrl(base: string): string {
  const u = new URL(base);
  if (u.username || u.password || u.search || u.hash) throw new Error('INVALID_PREFIX');
  const local = ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
    throw new Error('HTTPS_REQUIRED');
  u.pathname = u.pathname.replace(/\/+$/,'') + '/chat/completions';
  return u.toString();
}
```

**Step 4: vault 注入 encrypt/decrypt/read/write 接口；用 Electron safeStorage 实现密文读写，只在 app ready 后访问；写临时文件、rename，文件权限 0600。**

**Step 5: 加密不可用或钥匙串拒绝时仅内存保存并回传 persistent:false；修改密钥为空不覆盖已有值，删除使用独立命令。**

**Step 6: 补充本机 HTTP、URL 用户密码/query、密文无明文、加密失败不落盘与读取失败不覆盖旧文件测试。**

**Step 7: 验证通过**

Run: `npm test -- tests/settings.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：vault 的平台适配按选定 Electron 的实际 API 编写；不依赖只有新版文档才有的 async API，不把本地密文说成 API Key 原文存于钥匙串。

**Step 8: 提交**

```bash
git add -- src/main/settings/model.ts src/main/settings/vault.ts tests/settings.test.ts
git diff --cached --name-only
git commit -m "feat: implement 模型配置与密钥 vault"
```


### Task 5: 跨分块 SSE 解析

**Files:**
- Create/Modify: `src/main/providers/model/sse.ts`
- Test: `tests/sse.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { SseDecoder } from '../src/main/providers/model/sse';
test('中文跨字节与 CRLF 分隔仍正确', () => {
  const got:string[]=[]; const parser=new SseDecoder(x=>got.push(x));
  const bytes=new TextEncoder().encode('data: 中文\r\n\r\n');
  for (const byte of bytes) parser.push(new Uint8Array([byte]));
  parser.end(); expect(got).toEqual(['中文']);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/sse.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export class SseDecoder {
  private decoder=new TextDecoder(); private pending=''; private data:string[]=[];
  constructor(private emit:(value:string)=>void) {}
  push(bytes:Uint8Array):void { this.consume(this.decoder.decode(bytes,{stream:true})); }
  end():void { this.consume(this.decoder.decode()); }
  private consume(text:string):void {
    this.pending+=text;
    for (;;) {
      const match=/\r\n|\n|\r/.exec(this.pending);
      if (!match) return;
      const i=match.index;
      if (this.pending[i]==='\r' && i===this.pending.length-1) return;
      const line=this.pending.slice(0,i);
      this.pending=this.pending.slice(i+match[0].length);
      if (line==='') {
        if (this.data.length) this.emit(this.data.join('\n'));
        this.data=[];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /,''));
      }
    }
  }
}
```

**Step 4: 补充多行 data、注释、CRLF 跨分块、无最终分隔符测试；未完整事件不能派发。**

**Step 5: 为 pending 和单事件数据各加 1 MB 上限，超限返回 PROTOCOL_LIMIT；end 处理孤立 CR 的明确终止行为，补充相应测试。**

**Step 6: 验证通过**

Run: `npm test -- tests/sse.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：解析器只负责 SSE framing，JSON 错误由 Task 6 分类；不在此处吞掉所有异常。

**Step 7: 提交**

```bash
git add -- src/main/providers/model/sse.ts tests/sse.test.ts
git diff --cached --name-only
git commit -m "feat: implement 跨分块 SSE 解析"
```


### Task 6: Chat Completions 事件归一化

**Files:**
- Create/Modify: `src/main/providers/model/chunk.ts`
- Test: `tests/model-chunk.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { decodeChunk } from '../src/main/providers/model/chunk';
test('标准 delta、空 usage 与 DONE', () => {
  expect(decodeChunk('{"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}'))
    .toEqual({text:'你好',finish:null});
  expect(decodeChunk('{"choices":[],"usage":{"total_tokens":3}}')).toEqual({text:'',finish:null});
  expect(decodeChunk('[DONE]')).toEqual({text:'',finish:'done'});
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/model-chunk.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function decodeChunk(data:string):{text:string;finish:string|null} {
  if (data==='[DONE]') return {text:'',finish:'done'};
  const obj=JSON.parse(data);
  if (obj.error) throw new Error('PROVIDER_ERROR');
  if (!Array.isArray(obj.choices)) throw new Error('INVALID_CHUNK');
  const choice=obj.choices[0];
  const text=choice?.delta?.content;
  if (text!=null && typeof text!=='string') throw new Error('INVALID_CONTENT');
  return {text:text??'',finish:choice?.finish_reason??null};
}
```

**Step 4: 把 stop/length/content_filter/tool_calls 映射成可显示的结束原因；首版工具调用返回 UNSUPPORTED_OUTPUT，不静默成功。**

**Step 5: 加入 role-only、错误对象、非法 JSON、非字符串文本、空内容结束测试；网络正常 EOF 无结束信号视为 interrupted。**

**Step 6: 验证通过**

Run: `npm test -- tests/model-chunk.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

**Step 7: 提交**

```bash
git add -- src/main/providers/model/chunk.ts tests/model-chunk.test.ts
git diff --cached --name-only
git commit -m "feat: implement Chat Completions 事件归一化"
```


### Task 7: 模型请求取消与终态

**依赖：** Tasks 4–6

**Files:**
- Create/Modify: `src/main/providers/model/client.ts`
- Create/Modify: `src/main/runtime/request-slot.ts`
- Create/Modify: `src/main/index.ts`
- Create/Modify: `src/renderer/src/pages/Prepare.tsx`
- Create/Modify: `src/renderer/src/pages/Overlay.tsx`
- Test: `tests/model-client.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { RequestSlot } from '../src/main/runtime/request-slot';
test('新请求使旧增量无效，终态只提交一次', () => {
  const slot=new RequestSlot(); const a=slot.begin(); const b=slot.begin();
  expect(slot.accept(a)).toBe(false); expect(slot.accept(b)).toBe(true);
  expect(slot.finish(b)).toBe(true); expect(slot.finish(b)).toBe(false);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/model-client.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export class RequestSlot {
  private current=0; private done=true;
  begin():number { this.done=false; return ++this.current; }
  accept(id:number):boolean { return id===this.current && !this.done; }
  finish(id:number):boolean {
    if (!this.accept(id)) return false;
    this.done=true; return true;
  }
}
```

**Step 4: client 注入 fetch；POST 标准 messages/model/stream，Bearer 从 vault 读取；redirect:error，不返回鉴权头给 UI。**

**Step 5: 实现 AbortController、首次响应 30 秒超时和流读取空闲 30 秒超时；有输出后不自动重试，尚无输出的临时错误最多一次。**

**Step 6: 用本地测试 HTTP server 覆盖 401/429/500、跨源重定向、分块中文、取消后迟到结果、截断和非流式完整返回；准备页先建立模型配置、测试、手动提问和取消控件，浮窗先建立只读回答区，main 接具名 IPC。Task 23 再集成完整音频/历史页面。**

**Step 7: 验证通过**

Run: `npm test -- tests/model-client.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：每个请求有 sessionId/generation/requestId；取消显示“停止接收”；不得声称远端计费停止。

**Step 8: 提交**

```bash
git add -- src/main/providers/model/client.ts src/main/runtime/request-slot.ts src/main/index.ts src/renderer/src/pages/Prepare.tsx src/renderer/src/pages/Overlay.tsx tests/model-client.test.ts
git diff --cached --name-only
git commit -m "feat: implement 模型请求取消与终态"
```


### Task 8: 浮窗策略与快捷键

**Files:**
- Create/Modify: `src/main/window/policy.ts`
- Create/Modify: `src/main/window/manager.ts`
- Create/Modify: `src/main/index.ts`
- Test: `tests/window-policy.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { windowPolicy } from '../src/main/window/policy';
test('浮窗保持置顶且保护状态独立', () => {
  expect(windowPolicy('overlay',true)).toEqual({top:true,allWorkspaces:true,protected:true});
  expect(windowPolicy('overlay',false).top).toBe(true);
  expect(windowPolicy('prepare',true).top).toBe(false);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/window-policy.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function windowPolicy(mode:'prepare'|'overlay', protectedContent:boolean) {
  return {top:mode==='overlay',allWorkspaces:mode==='overlay',protected:protectedContent};
}
```

**Step 4: 创建普通准备窗口与单独透明无边框 panel 浮窗；window manager 应用置顶、全屏/跨工作区与保护策略。blur 不 hide；显式关闭浮窗不等于终止会话。**

**Step 5: 展开/收起只改 bounds；持久化位置时限制到现有屏幕可见区域；show/重建时重应用保护。**

**Step 6: 注册可修改的显示/隐藏、展开/收起、停止快捷键；冲突不覆盖其他应用，回传注册失败；退出 unregisterAll。**

**Step 7: 验证通过**

Run: `npm test -- tests/window-policy.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：运行 `npm run dev`，点击别的窗口后浮窗仍可见；保护开启与关闭不会改变置顶。真实共享需 Task 9。

**Step 8: 提交**

```bash
git add -- src/main/window/policy.ts src/main/window/manager.ts src/main/index.ts tests/window-policy.test.ts
git diff --cached --name-only
git commit -m "feat: implement 浮窗策略与快捷键"
```


### Task 9: 提前验证腾讯会议整屏共享

**Files:** Create: `docs/acceptance/window-sharing.md`；Create: `e2e/window.spec.ts`, `playwright.config.ts`。

**Step 1:** Playwright Electron 启动构建目录应用，检查准备/浮窗是两个本地页面，浮窗失焦不触发 hide，展开收起保留窗口 ID；测试只测自身窗口，不操作会议。

**Step 2:** `npm run build`；`npm run test:e2e -- e2e/window.spec.ts`。Expected: PASS；失败先查平台实现，不把 mock 调用记录当作共享证据。

**Step 3:** 记录 macOS、硬件、Electron、腾讯会议版本、共享整个屏幕方式和保护设置；用户自行进入共享。

**Step 4:** 由独立接收端观察浮窗是否出现，分别测试失焦、收起、展开、全屏、跨工作区、停止后重新共享；每个场景写明本机/接收端表现和证据来源。没有接收端则记“未验证”。

**Step 5:** 若当前环境失败，保存真实结果，评估窗口参数或原生方案是否需要新设计。独立文本开发仍可继续；关键共享能力不标为通过，未经新设计批准不加入原生扩展。

**Step 6:** `git add -- docs/acceptance/window-sharing.md e2e/window.spec.ts playwright.config.ts`；检查 staged；`git commit -m "test: record overlay sharing compatibility"`。


### Task 10: PCM16 编码与持续时钟

**Files:**
- Create/Modify: `src/audio/pcm.ts`
- Create/Modify: `src/audio/clock.ts`
- Test: `tests/pcm.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { pcm16 } from '../src/audio/pcm';
test('饱和并以小端编码', () => {
  const out=pcm16(new Float32Array([-2,-1,0,1,2]));
  const view=new DataView(out.buffer);
  expect(Array.from({length:5},(_,i)=>view.getInt16(i*2,true)))
    .toEqual([-32768,-32768,0,32767,32767]);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/pcm.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function pcm16(input:Float32Array):Uint8Array {
  const bytes=new Uint8Array(input.length*2); const view=new DataView(bytes.buffer);
  input.forEach((x,i)=>{
    if (!Number.isFinite(x)) x=0;
    x=Math.max(-1,Math.min(1,x));
    view.setInt16(i*2,Math.round(x<0?x*32768:x*32767),true);
  });
  return bytes;
}
```

**Step 4: 实现帧时钟：累计 startSample 与 sequence；时间由样本数转换，不能用 UI 到达时间代替。**

**Step 5: 补充 NaN/Infinity、边界 ±1、空输入、分帧样本时间连续性测试。**

**Step 6: 验证通过**

Run: `npm test -- tests/pcm.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

**Step 7: 提交**

```bash
git add -- src/audio/pcm.ts src/audio/clock.ts tests/pcm.test.ts
git diff --cached --name-only
git commit -m "feat: implement PCM16 编码与持续时钟"
```


### Task 11: 跨帧重采样与抗混叠

**Files:**
- Create/Modify: `src/audio/resampler.ts`
- Test: `tests/resampler.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { outputCount } from '../src/audio/resampler';
test('输出计数不按块舍入', () => {
  expect(outputCount(441000,44100,16000)).toBe(160000);
  expect(outputCount(480000,48000,16000)).toBe(160000);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/resampler.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function outputCount(inputSamples:number,inputRate:number,outputRate:number):number {
  if (!Number.isInteger(inputSamples)||inputSamples<0||inputRate<=0||outputRate<=0)
    throw new Error('INVALID_AUDIO_CLOCK');
  return Math.floor(inputSamples*outputRate/inputRate);
}
```

**Step 4: 先写 partition-invariance 测试：同一段正弦输入整段/128/4096 样本分块，结束后的 PCM 和样本数一致。**

**Step 5: 实现连续低通 FIR 状态与分数采样相位；固定输入历史窗口，不在每帧重置；finish 按统一尾帧补零策略完成并补偿滤波群延迟。此实现单独提交，不只交计数函数。**

**Step 6: 加入 1 kHz 通带及高于 8 kHz 测试输入的频谱验收，目标混叠分量比未滤波基线至少降低 30 dB；该值是验收目标，不是已测值。**

**Step 7: 验证通过**

Run: `npm test -- tests/resampler.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：44.1/48 kHz 各 10 秒与 10 分钟的结束计数误差 ≤1 输出样本；same-rate 路径不额外滤波。

**Step 8: 提交**

```bash
git add -- src/audio/resampler.ts tests/resampler.test.ts
git diff --cached --name-only
git commit -m "feat: implement 跨帧重采样与抗混叠"
```


### Task 12: 音频有界队列

**Files:**
- Create/Modify: `src/main/audio/frame-queue.ts`
- Test: `tests/frame-queue.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { FrameQueue } from '../src/main/audio/frame-queue';
test('按音频时长限流并报告缺口', () => {
  const gaps:number[]=[]; const q=new FrameQueue<number>(5,x=>gaps.push(x));
  q.push(1,3); q.push(2,3);
  expect(q.take()).toBe(2); expect(gaps).toEqual([3]);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/frame-queue.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export class FrameQueue<T> {
  private rows:{value:T;seconds:number}[]=[]; private total=0;
  constructor(private limit:number,private onDrop:(seconds:number)=>void) {}
  push(value:T,seconds:number):void {
    if (!(seconds>0) || !Number.isFinite(seconds)) throw new Error('INVALID_DURATION');
    this.rows.push({value,seconds}); this.total+=seconds;
    while(this.total>this.limit){
      const lost=this.rows.shift()!; this.total-=lost.seconds; this.onDrop(lost.seconds);
    }
  }
  take():T|undefined {
    const row=this.rows.shift(); if (!row) return;
    this.total-=row.seconds; return row.value;
  }
}
```

**Step 4: 发送队列使用 peek/ack 两阶段，发送拒绝前不移除；连接断开时按适配器能力重发或明确记缺口，不能盲目重放旧音频。**

**Step 5: 输入 IPC 采用 credit/ACK，未确认 PCM 不超过来源 5 秒；在采集端也设上限，避免只限制主进程而 MessagePort 无界增长。**

**Step 6: 录音采用独立 10 秒队列，溢出停止录音并报错；添加限速、单帧超限、发送拒绝、源隔离测试。**

**Step 7: 验证通过**

Run: `npm test -- tests/frame-queue.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

**Step 8: 提交**

```bash
git add -- src/main/audio/frame-queue.ts tests/frame-queue.test.ts
git diff --cached --name-only
git commit -m "feat: implement 音频有界队列"
```


### Task 13: 受控采集与 AudioWorklet

**Files:**
- Create/Modify: `src/capture/index.html`
- Create/Modify: `src/capture/controller.ts`
- Create/Modify: `src/capture/pcm.worklet.ts`
- Create/Modify: `src/main/audio/capture-bridge.ts`
- Create/Modify: `src/preload/capture.ts`
- Test: `tests/capture-lifecycle.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { stopTracks } from '../src/capture/controller';
test('结束释放所有音轨', () => {
  const stopped:string[]=[];
  const tracks=['mic','screen'].map(id=>({stop:()=>stopped.push(id)}));
  stopTracks(tracks); expect(stopped).toEqual(['mic','screen']);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/capture-lifecycle.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function stopTracks(tracks:ReadonlyArray<{stop():void}>):void {
  for(const track of tracks) track.stop();
}
```

**Step 4: 添加 electron-vite capture 多页面入口和独立 sandbox preload；主进程通过受限控制命令启动采集，PCM 用 MessagePort 转移 ArrayBuffer。**

**Step 5: 麦克风用 getUserMedia，系统音频按已选 Electron 的 setDisplayMediaRequestHandler/getDisplayMedia 流程实现；视频不保存/上传，采集依赖的轨道在结束一并停止。**

**Step 6: AudioWorklet 各来源独立输出 Float32 块；主线程调用持续重采样与 PCM 编码；禁止音频回调读密钥、写文件或等待网络。**

**Step 7: 补充启动中 stop、部分来源失败、设备移除、重复 stop 测试；检测实际 audio track 及输入能量，不把有轨道当作采集成功。**

**Step 8: 验证通过**

Run: `npm test -- tests/capture-lifecycle.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：本机试验麦克风与播放的已知系统测试音，各自波形/时钟可见；静音不直接当失败，已知测试音存在却持续零输入时提示授权/能力异常。

**Step 9: 提交**

```bash
git add -- src/capture/index.html src/capture/controller.ts src/capture/pcm.worklet.ts src/main/audio/capture-bridge.ts src/preload/capture.ts tests/capture-lifecycle.test.ts
git diff --cached --name-only
git commit -m "feat: implement 受控采集与 AudioWorklet"
```


### Task 14: ASR 接口与 mock 服务

**Files:**
- Create/Modify: `src/main/providers/asr/contracts.ts`
- Create/Modify: `tests/helpers/mock-asr.ts`
- Test: `tests/asr-contract.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { MockAsr } from './helpers/mock-asr';
test('临时/确认结果由相同片段关联', async () => {
  const got:any[]=[]; const asr=new MockAsr(x=>got.push(x));
  await asr.connect(); asr.emit('a','数',false); asr.emit('a','数组',true);
  await asr.finish(); expect(got.map(x=>[x.segmentId,x.isFinal])).toEqual([['a',false],['a',true]]);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/asr-contract.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export class MockAsr {
  private revisions=new Map<string,number>(); private open=false;
  constructor(private send:(event:unknown)=>void) {}
  async connect():Promise<void>{this.open=true;}
  emit(segmentId:string,text:string,isFinal:boolean):void{
    if(!this.open) throw new Error('NOT_CONNECTED');
    const revision=(this.revisions.get(segmentId)??-1)+1;
    this.revisions.set(segmentId,revision);
    this.send({segmentId,text,isFinal,revision});
  }
  async finish():Promise<void>{this.open=false;}
}
```

**Step 4: 定义 connect/send/finish/close 与 capability 描述，传入 AbortSignal、sourceId 和流代次；finish 结果区分确认/超时/中断。**

**Step 5: 添加 fake WebSocket/server fixture 支持延迟握手、1008、无终止 ACK、分块数据和重放，不连接原产品服务。**

**Step 6: 验证通过**

Run: `npm test -- tests/asr-contract.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：mock 类型在生产配置中不可选择；只有端到端测试入口可以注入。

**Step 7: 提交**

```bash
git add -- src/main/providers/asr/contracts.ts tests/helpers/mock-asr.ts tests/asr-contract.test.ts
git diff --cached --name-only
git commit -m "feat: implement ASR 接口与 mock 服务"
```


### Task 15: ASR 重连调度与停止竞态

**Files:**
- Create/Modify: `src/main/providers/asr/retry.ts`
- Test: `tests/asr-retry.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test, vi } from 'vitest';
import { RetryGate } from '../src/main/providers/asr/retry';
test('stop 取消退避回调', () => {
  vi.useFakeTimers(); const connect=vi.fn(); const gate=new RetryGate();
  gate.schedule(connect,1000); gate.stop(); vi.advanceTimersByTime(5000);
  expect(connect).not.toHaveBeenCalled(); vi.useRealTimers();
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/asr-retry.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export class RetryGate {
  private timer:ReturnType<typeof setTimeout>|undefined; private stopped=false;
  schedule(connect:()=>void,delay:number):void {
    if(this.stopped) return;
    if(this.timer) clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=undefined;if(!this.stopped) connect();},delay);
  }
  stop():void {this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;}
}
```

**Step 4: 加入 10 秒握手超时、最多连续三次退避 1/2/4 秒与可注入 jitter；30 秒稳定后才重置预算。**

**Step 5: 每次连接附 generation/epoch；stop 取消 timer、握手、socket 和 pending finish，并结算等待 Promise。**

**Step 6: 回归测试成功打开立即断开不能无限重置、stop 期间 onopen、clean 1008 按供应商分类、finish-close 竞态；连接层不持有 recorder.start。**

**Step 7: 验证通过**

Run: `npm test -- tests/asr-retry.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

**Step 8: 提交**

```bash
git add -- src/main/providers/asr/retry.ts tests/asr-retry.test.ts
git diff --cached --name-only
git commit -m "feat: implement ASR 重连调度与停止竞态"
```


### Task 16: 选定一个真实 ASR 并实现供应商适配

**依赖：** Tasks 10–15；用户选定 ASR 服务及本地凭据。这里尚无供应商，因此不能诚实地提前给出其真实鉴权或协议代码。此项是有输入门槛的任务，不是已完成的通用适配器。

**Files:** Create: `docs/providers/asr-selected.md`, `src/main/providers/asr/selected-provider.ts`, `tests/asr-selected.test.ts`, `tests/fixtures/asr-selected/handshake.json`, `tests/fixtures/asr-selected/partial.json`, `tests/fixtures/asr-selected/final.json`, `tests/fixtures/asr-selected/error.json`。

**Step 1:** 确定一家服务，打开其官方实时协议；填写端点、鉴权、PCM 格式、最大帧、时限、结束 ACK、错误码、片段 ID、时间单位和并发限制。没有明确重放支持时设 replay:false。

**Step 2:** 只用公开文档样例或合成内容建立脱敏 fixture，写归一化失败测试：临时→确认、time→毫秒、流代次、错误分类和终止 ACK。`npm test -- tests/asr-selected.test.ts`，Expected: FAIL。

**Step 3:** 写请求鉴权及握手编码函数，测试凭据不写到日志；运行同文件测试。一次只完成一个函数。

**Step 4:** 写音频发送封装，按文档处理帧限制和流控；测试失败时队列不静默消失。

**Step 5:** 写结果解析与稳定 segmentId/revision 转换；不能无依据把 receivedAt 当 startMs，也不能按文本去重。

**Step 6:** 写 finish/close/超时协议并接入 RetryGate；finish Promise 在任何路径都结束。

**Step 7:** 用独立配置的服务发送已知中文短语，验证单路与两路并发、停止及余额/鉴权错误。双路不支持则启动前要求选单路。人工验证记录在 asr-selected.md；不自动提高套餐或充值。

**Step 8:** `npm test -- tests/asr-selected.test.ts`、`npm run typecheck`；Expected: PASS。真实测试只在用户明确配置凭据后执行；未执行写“未验证”。

**Step 9:** `git add -- docs/providers/asr-selected.md src/main/providers/asr/selected-provider.ts tests/asr-selected.test.ts tests/fixtures/asr-selected/handshake.json tests/fixtures/asr-selected/partial.json tests/fixtures/asr-selected/final.json tests/fixtures/asr-selected/error.json`；检查 staged；`git commit -m "feat: add selected realtime asr provider"`。

**实施前的局部补计划：** 服务确定后把 Steps 3–6 的具体函数、失败测试和最小实现代码补进本任务再执行，不用猜测或兼容原产品私有服务；其余任务可先行。


### Task 17: 上下文裁剪与不可变快照

**Files:**
- Create/Modify: `src/main/context/budget.ts`
- Create/Modify: `src/main/context/build.ts`
- Create/Modify: `src/main/context/templates.ts`
- Test: `tests/context.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { estimateTokens } from '../src/main/context/budget';
test('估算不把中文按英文单词低估', () => {
  expect(estimateTokens('数组')).toBe(6);
  expect(estimateTokens('')).toBe(0);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/context.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function estimateTokens(text:string):number {
  return new TextEncoder().encode(text).byteLength;
}
```

**Step 4: 使用保守 UTF-8 字节估算并给每消息固定结构开销，输入预算留 20% 余量；系统说明和当前问题超限时拒绝并提示缩短。**

**Step 5: 按旧回答→旧转写→资料顺序裁剪；资料先预览确认，临时转写排除；保存省略/截断元数据。**

**Step 6: 把说明作为 system，转写/资料作为带来源的 user 引用文本；构建后深复制/冻结，补充源数据后续修改不影响请求测试。**

**Step 7: 验证通过**

Run: `npm test -- tests/context.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：估算是保守本地策略而非精确 token 计数；服务报告超限时不无限重试。

**Step 8: 提交**

```bash
git add -- src/main/context/budget.ts src/main/context/build.ts src/main/context/templates.ts tests/context.test.ts
git diff --cached --name-only
git commit -m "feat: implement 上下文裁剪与不可变快照"
```


### Task 18: 自动建议合并与手动优先

**Files:**
- Create/Modify: `src/main/context/suggestion.ts`
- Test: `tests/suggestion.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { LatestCandidate } from '../src/main/context/suggestion';
test('运行中只保留最新候选', () => {
  const queue=new LatestCandidate<string>();queue.offer('a');queue.offer('b');
  expect(queue.take()).toBe('b');expect(queue.take()).toBeUndefined();
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/suggestion.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export class LatestCandidate<T> {
  private value:T|undefined;
  offer(value:T):void{this.value=value;}
  take():T|undefined{const value=this.value;this.value=undefined;return value;}
  clear():void{this.value=undefined;}
}
```

**Step 4: 对确认转写建立 1.5 秒 debounce；候选包含片段版本范围，已消费范围不再次触发。**

**Step 5: 手动问题取消正在运行的自动请求并清空过期候选；暂停/stop 清 timer；补充临时转写不触发、密集确认只触发一次、手动优先和迟到结果测试。**

**Step 6: 验证通过**

Run: `npm test -- tests/suggestion.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

**Step 7: 提交**

```bash
git add -- src/main/context/suggestion.ts tests/suggestion.test.ts
git diff --cached --name-only
git commit -m "feat: implement 自动建议合并与手动优先"
```


### Task 19: 会话生命周期与 drain 白名单

**Files:**
- Create/Modify: `src/main/session/controller.ts`
- Create/Modify: `src/main/session/deadline.ts`
- Test: `tests/session-stop.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test, vi } from 'vitest';
import { within } from '../src/main/session/deadline';
test('无结束确认的 Promise 也有终态', async () => {
  vi.useFakeTimers();const result=within(new Promise(()=>{}),3000);
  const checked=expect(result).rejects.toThrow('TIMEOUT');
  await vi.advanceTimersByTimeAsync(3000);await checked;vi.useRealTimers();
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/session-stop.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export async function within<T>(work:Promise<T>,ms:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('TIMEOUT')),ms);
  })]);}finally{if(timer)clearTimeout(timer);}
}
```

**Step 4: 定义 idle/starting/running/stopping/stopped/failed 合法转换；启动校验和来源准备，部分失败等待明确单路选择。**

**Step 5: stop 共享同一个 Promise：增 generation→取消 timer/模型→停采集取尾帧→ASR 3 秒 drain→录音 10 秒 finalize→写终态/释放。超时不仅 race 结束，还必须 abort/close 底层工作。**

**Step 6: drain 创建独立身份，只接纳本次 final transcript/save 结果；旧普通事件、迟到握手不能恢复采集。**

**Step 7: 覆盖启动中 stop、stop×2、stop 后 connect、finalize-close、模型超时、DB 失败；运行中 ASR degraded 不重启会话。**

**Step 8: 验证通过**

Run: `npm test -- tests/session-stop.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：缺少真实 ASR 时可用 mock 完成控制器测试；不能用它标记 Task 16 通过。

**Step 9: 提交**

```bash
git add -- src/main/session/controller.ts src/main/session/deadline.ts tests/session-stop.test.ts
git diff --cached --name-only
git commit -m "feat: implement 会话生命周期与 drain 白名单"
```


### Task 20: SQLite 历史与删除导出

**依赖：** Task 2；与 17–19 可独立安排，但集成依赖 19

**Files:**
- Create/Modify: `src/main/storage/schema.sql`
- Create/Modify: `src/main/storage/database.ts`
- Create/Modify: `src/main/storage/history.ts`
- Test: `tests/history.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { historyText } from '../src/main/storage/history';
test('导出稳定保留来源与内容', () => {
  expect(historyText([{source:'system',text:'什么是数组'}])).toBe('[system] 什么是数组');
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/history.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function historyText(rows:ReadonlyArray<{source:string;text:string}>):string{
  return rows.map(row=>`[${row.source}] ${row.text}`).join('\n');
}
```

**Step 4: schema.sql 建 sessions/provider_configs/transcript_segments/messages/documents/recordings/preferences；转写唯一键为 session/source/epoch/segment；schema 版本迁移、外键和事务。**

**Step 5: 以临时 SQLite 文件测试同片段 UPSERT、重启重读、删除级联、事务失败不误报保存；原生 SQLite 测试使用 Node ABI，打包时另测 Electron ABI。**

**Step 6: 历史导出只写用户选择路径；删除录音只访问应用记录的管理路径，失败回传残留，不删除导入原文件；DB 失败保留内存导出并标记未保存。**

**Step 7: 验证通过**

Run: `npm test -- tests/history.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

**Step 8: 提交**

```bash
git add -- src/main/storage/schema.sql src/main/storage/database.ts src/main/storage/history.ts tests/history.test.ts
git diff --cached --name-only
git commit -m "feat: implement SQLite 历史与删除导出"
```


### Task 21: WAV 写入、滚动与恢复

**Files:**
- Create/Modify: `src/main/recording/wav.ts`
- Create/Modify: `src/main/recording/writer.ts`
- Create/Modify: `src/main/recording/recovery.ts`
- Test: `tests/recording.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { wavHeader } from '../src/main/recording/wav';
test('16k 单声道 PCM16 头包含真实长度', () => {
  const h=wavHeader(32000,16000);const v=new DataView(h.buffer);
  expect(new TextDecoder().decode(h.slice(0,4))).toBe('RIFF');
  expect(v.getUint32(40,true)).toBe(32000);expect(v.getUint32(28,true)).toBe(32000);
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/recording.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function wavHeader(bytes:number,rate:number):Uint8Array{
  if(bytes<0 || bytes%2 || bytes>0xffffffff-36)throw new Error('INVALID_WAV_SIZE');
  const h=new Uint8Array(44);const v=new DataView(h.buffer);
  const tag=(at:number,text:string)=>h.set(new TextEncoder().encode(text),at);
  tag(0,'RIFF');v.setUint32(4,36+bytes,true);tag(8,'WAVE');tag(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);
  v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,bytes,true);return h;
}
```

**Step 4: 按来源写 .pcm.part，记录一分钟检查点；结束流式合并头/数据并 atomic rename，不把整场录音读到内存。**

**Step 5: 写入 Promise 排队有界；ENOSPC/超限停止录音但允许转写；60 分钟滚动，完成后有独立文件记录。**

**Step 6: 恢复只针对应用 manifest 里的临时文件，校验长度/偶数字节；提供恢复/删除，未完成文件不当成功音频；补充崩溃恢复、磁盘失败、超时与滚动测试。**

**Step 7: 验证通过**

Run: `npm test -- tests/recording.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：Task 19 的 10 秒截止要主动关闭 writer；保存失败保留可恢复片段，不吞异常。

**Step 8: 提交**

```bash
git add -- src/main/recording/wav.ts src/main/recording/writer.ts src/main/recording/recovery.ts tests/recording.test.ts
git diff --cached --name-only
git commit -m "feat: implement WAV 写入、滚动与恢复"
```


### Task 22: 本地文档隔离提取与确认

**Files:**
- Create/Modify: `src/main/documents/limits.ts`
- Create/Modify: `src/main/documents/service.ts`
- Create/Modify: `src/main/documents/worker.ts`
- Test: `tests/documents.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { checkDocumentSize } from '../src/main/documents/limits';
test('超限资料不进入解析器', () => {
  expect(()=>checkDocumentSize(50*1024*1024+1)).toThrow('DOCUMENT_TOO_LARGE');
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/documents.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function checkDocumentSize(bytes:number):void{
  if(!Number.isInteger(bytes)||bytes<0)throw new Error('INVALID_SIZE');
  if(bytes>50*1024*1024)throw new Error('DOCUMENT_TOO_LARGE');
}
```

**Step 4: worker_threads 隔离解析；30 秒截止 terminate；TXT 读取、mammoth DOCX、pdfjs 文本 PDF 按确切锁定版本实现。**

**Step 5: DOCX 解压总量按 ZIP entry 实際累计 ≤100 MB，不能只信压缩大小；为 ZIP 安全读取安装并锁定一个提供 entry size/stream 的库。**

**Step 6: 准备页预览提取文本，只有 confirm(token) 后加入上下文；opaque token 映射主进程选定文件，不接收任意 renderer 路径。**

**Step 7: 建立合成中文 PDF/DOCX/TXT 与损坏、超限、空文本、扫描件 fixtures；扫描件反馈无可提取文字，不误报 OCR 成功。**

**Step 8: 验证通过**

Run: `npm test -- tests/documents.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：原始文件不上传；确认的资料文本才进入模型上下文，解析期间停止/退出也能清理 worker。

**Step 9: 提交**

```bash
git add -- src/main/documents/limits.ts src/main/documents/service.ts src/main/documents/worker.ts tests/documents.test.ts
git diff --cached --name-only
git commit -m "feat: implement 本地文档隔离提取与确认"
```


### Task 23: 三页面集成与可观察状态

**Files:**
- Create/Modify: `src/renderer/src/pages/Prepare.tsx`
- Create/Modify: `src/renderer/src/pages/Overlay.tsx`
- Create/Modify: `src/renderer/src/pages/History.tsx`
- Create/Modify: `src/renderer/src/state/view.ts`
- Create/Modify: `src/renderer/src/components/Answer.tsx`
- Create/Modify: `e2e/session.spec.ts`
- Test: `tests/view-state.test.ts`

**Step 1: 写失败测试**

```ts
import { expect, test } from 'vitest';
import { saveLabel } from '../src/renderer/src/state/view';
test('保存失败不能显示已保存', () => {
  expect(saveLabel('failed')).toBe('保存失败');expect(saveLabel('saved')).toBe('已保存');
});
```

**Step 2: 验证失败**

Run: `npm test -- tests/view-state.test.ts`。Expected: 缺少实现/契约不符合导致 FAIL；不得以测试语法错误作为有效红灯。

**Step 3: 实现最小核心**

```ts
export function saveLabel(state:'off'|'saving'|'saved'|'failed'):string{
  return {off:'未录音',saving:'保存中',saved:'已保存',failed:'保存失败'}[state];
}
```

**Step 4: 准备页接模型/ASR 独立测试、资料确认、来源选择、文本默认保存与录音默认关闭；始终显示实际外发目的地。**

**Step 5: 浮窗接来源/连接状态、临时/确认转写、回答流、取消、手动/自动切换、停止及保护启用/环境未验证标识。**

**Step 6: 历史页接会话查看/删除/文本导出/录音恢复；回答用文本或禁 HTML 的 Markdown，外链使用主进程协议白名单。**

**Step 7: 端到端 mock 会话验证生成→取消→停止→保存失败→历史导出，并覆盖 XSS 文本只显示内容；组件卸载必须取消事件订阅。**

**Step 8: 验证通过**

Run: `npm test -- tests/view-state.test.ts`；`npm run typecheck`。Expected: 本任务所有边界测试 PASS、类型检查退出 0。

附加验收：运行 `npm run build`、`npm run test:e2e -- e2e/session.spec.ts`；Expected: PASS。此步骤不访问真实付费接口。

**Step 9: 提交**

```bash
git add -- src/renderer/src/pages/Prepare.tsx src/renderer/src/pages/Overlay.tsx src/renderer/src/pages/History.tsx src/renderer/src/state/view.ts src/renderer/src/components/Answer.tsx e2e/session.spec.ts tests/view-state.test.ts
git diff --cached --name-only
git commit -m "feat: implement 三页面集成与可观察状态"
```


### Task 24: macOS 打包与真实服务冒烟

**Files:** Create: `electron-builder.yml`, `build/entitlements.mac.plist`, `docs/acceptance/provider-smoke.md`, `scripts/check-package.mjs`。

**Step 1:** electron-builder appId 设置为 `local.realtime.assistant`、productName 设置为 Local Realtime Assistant；打包列表仅包含 out、应用依赖和必要资源。指定 arm64，SQLite 原生依赖置于正确 unpack 位置。

**Step 2:** 增加 NSMicrophoneUsageDescription、NSAudioCaptureUsageDescription 及所选采集方式实际需要的权限说明；按选定 Electron 和发行签名方案核对 entitlements。不得机械复制原应用的权限或禁用系统保护。

**Step 3:** scripts/check-package.mjs 检查打包后的 app.asar 列表和 Info.plist：不存在分析目录、zip、密钥、录音；包含所需 usage keys。`npm run package:dir` 后运行 `node scripts/check-package.mjs dist/mac-arm64/Local\ Realtime\ Assistant.app`，Expected: exit 0。

**Step 4:** 直接启动 .app，分别测试麦克风、系统测试音与双路采集；检测真实信号和停止资源释放。开发时从终端启动正常，不证明打包权限正常。

**Step 5:** 用户在本地录入模型与 ASR 配置，原 Copilot 关闭；发送一条短文本与一段短中文语音，观察流式、转写、手动回答和保存；记录接口域名、版本、是否双路，不记录凭据或完整私人内容。

**Step 6:** 发行签名/公证仅在用户具备证书时执行；无证书可交付标明未签名的本地测试包，不宣称已完成正式分发。签名身份稳定性还影响钥匙串体验，测试重启后的 vault 读取。

**Step 7:** `npm run package:mac`；Expected: 可启动的 arm64 安装包，发布说明明确未验证项。打包成功不替代 Task 25。

**Step 8:** `git add -- electron-builder.yml build/entitlements.mac.plist docs/acceptance/provider-smoke.md scripts/check-package.mjs`；检查 staged；`git commit -m "build: package macos realtime assistant"`。

### Task 25: 故障矩阵、长时运行与最终验收

**Files:** Create: `tests/integration/recovery.test.ts`, `docs/acceptance/final-matrix.md`, `docs/user-guide.md`；Modify: `docs/acceptance/window-sharing.md`。

**Step 1:** 增加整合测试：模拟 ASR 掉线→退避→stop、发送拒绝、无 finish ACK、模型流截断、磁盘失败、SQLite 失败；检查终态、缺口、保存状态和资源数，不能只断言没有抛错。

**Step 2:** `npm test -- tests/integration/recovery.test.ts`，Expected: PASS；失败按 @superpowers:systematic-debugging 修复涉及的模块，并运行其受影响测试。

**Step 3:** `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`，Expected: 均退出 0；先确认 Task 24 的 SQLite Electron ABI 和 capture 入口已可用。记录执行命令和结果。

**Step 4:** 在真实安装包上做至少 60 分钟采集和滚动录音；每分钟记录 RSS、来源队列时长、gap 数、连接状态；停止后检查 socket、track、timer 都关闭。此项是长时手工验收，不要在单个工具调用中阻塞等待 60 分钟；保持可交互的采样进程，持续报告进展。

**Step 5:** 验证异常退出→启动→恢复片段，权限拒绝→单路继续，换设备及本机静音；用固定公开/合成中文语料测字错率和延迟分布。不预写质量指标结果。

**Step 6:** 按 Task 9 在最终安装包上重测腾讯会议整屏共享与真实接收端。原型/开发包通过不等于安装包通过；未通过或无接收端必须如实记载。

**Step 7:** 核对外发目的地只有已配置服务，renderer/数据库/log 没有 API Key；用户指南写清配置、启动、停止、保存、删除、权限、快捷键和共享兼容边界。

**Step 8:** final-matrix 每项只能是通过 / 失败 / 未验证 / 不适用，并附证据。任务完成与产品验收分开：ASR 未实测或关键共享场景失败时只能交付带限制的测试版本；不能声称满足完整首版目标。

**Step 9:** `git add -- tests/integration/recovery.test.ts docs/acceptance/final-matrix.md docs/user-guide.md docs/acceptance/window-sharing.md`；检查 staged；`git commit -m "test: verify realtime assistant release boundaries"`。

## 执行与检查点

每个任务：先红灯，再实现，再绿灯/类型检查，最后单独提交。基础工程及纯手工验收按上述明确命令验证，不额外编造对照实现的测试。任务内给出的最小测试之外，执行该任务列出的边界例，不以单一示例 PASS 代表组件完成。

检查点 A（Task 9 后）：自有模型+浮窗可演示，报告共享真实结果。若窗口需求无法满足，先调整设计再扩大平台工作。

检查点 B（Task 16 后）：真实 ASR、双路能力与停止已核对。若供应商未选定，继续 C 的 mock 开发，但保持真实接入未完成。

检查点 C（Task 23 后）：mock 端到端、本地历史和失败恢复可用，不声称真实精度已测。

检查点 D（Task 25 后）：按证据交付，通过的环境可用；限制和缺失明确记录。

执行选择由用户决定：

1. **本会话逐任务执行**：使用 @superpowers:subagent-driven-development，每个任务独立实现与审查，按检查点汇报。
2. **单独会话执行**：新会话进入本工作树，使用 @superpowers:executing-plans，按任务顺序及检查点执行。

两种方式都应先读本计划和设计。开启新会话、调度实现代理或安装依赖应在用户选定执行方式后进行。本轮产物仅为计划。
