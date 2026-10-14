# Realtime Assistant

Electron + React 实时语音助手源码，支持实时语音、独立深度回答、截图问答及可配置模型服务。

## 本地开发

```sh
npm ci
npm run dev
```

## 检查与构建

```sh
npm run typecheck
npm test
npm run build
```

模型与 ASR 凭据在应用设置中配置，不随源码分发。macOS 麦克风、系统音频及截图需相应系统授权。原生采集和打包目前以 macOS 为主。

## 当前状态

0.2.23 是稳定性改进候选版本：官方异步密钥访问、脱敏回答时间线、安装包启动探针和模型路由拆分。类型检查、217 项单元测试、关键界面回归及固定签名安装包的基础启动检查通过。

当前机器的旧凭据只读验收仍在系统钥匙串初始化阶段超时，尚未确认具体系统原因；已安装程序保持 0.2.21。不要把基础启动通过视为旧凭据验收通过。

安装包自检：

```sh
node scripts/packaged-smoke.cjs "/path/to/application.app"
# 显式只读验证旧密文副本；可能触发系统钥匙串提示
node scripts/packaged-smoke.cjs "/path/to/application.app" --existing-vault "/path/to/secrets.vault"
```

探针启动独立测试实例，基础检查不读取钥匙串、不录音、不调用模型。失败的测试证据保留在终端报告的临时目录。读取超时只结束应用等待，不宣称中断系统钥匙串操作。

签名证书、密钥、用户录音、转写记录、诊断日志和第三方逆向资料不包含在仓库中。
