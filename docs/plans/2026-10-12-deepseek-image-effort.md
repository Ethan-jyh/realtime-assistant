# DeepSeek 根据实际图片附件选择推理强度（0.2.9）

最终用户要求：只有实际附带截图/图片的模型请求使用max，其余文字请求（包括代码题）使用low。两类均thinking.enabled，不以题型、模式或“截图”关键词决定强度。规则只适用于官方DeepSeek域名与DeepSeek模型；Codex仍使用用户所选官方档位。

ANSWER_ASK将Boolean(payload.image)传入resolveThinking，ModelClient将结果写入thinking.type与reasoning_effort。answer.policy记录实际effort，不记录问题、截图或密钥。普通文字从关闭思考改为low，之前关闭思考的测速结果不代表本版本。

验证：
- 先通过失败测试确认旧“代码题max”规则不满足用户修正。
- 最终171项单元测试及主进程/前端类型检查通过，覆盖文字代码题low、关键词不升档、实际图片max、实际本机HTTP请求参数及外部提供方隔离。
- 修正前的完整界面回归首轮35通过、1失败、1真实账号用例默认跳过；失败对应Electron原生SIGBUS窗口销毁崩溃。单独生命周期2项及第二轮全量36项均通过。该偶发原生问题没有修改，不宣称根治。
- 最终规则构建的截图、问答、Codex、发言人及生命周期6项界面回归通过。
- 固定签名打包及严格验证通过。覆盖同一路径；安装前后assistant-settings.json、model-settings.json与secrets.vault的SHA256一致，签名designated requirement一致。
- 安装包内验证图片决定max/low的逻辑及实际payload.image参数存在。

未进行会议检测规避测试，也未向真实模型发送截图。截图可见性、系统隐私提示及会议客户端检测是不同问题，不能从本机界面推断远端不可检测。
