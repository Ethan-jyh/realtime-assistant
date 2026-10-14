import { useWindowDrag } from "../hooks/useWindowDrag";
import { MarkdownAnswer } from "../components/MarkdownAnswer";
import React, { useState, useEffect, useRef } from "react";
declare global {
  interface Window {
    api?: any;
  }
}
export function PreparePage({
  onBack,
  initialProfile,
}: { onBack?: () => void; initialProfile?: any } = {}): React.JSX.Element {
  const dragRef = useWindowDrag("prepare");
  const profileIdRef = useRef(initialProfile?.id);
  const [profileId, setProfileId] = useState(initialProfile?.id),
    [profileName, setProfileName] = useState(initialProfile?.name ?? "");
  const [workspaceId, setWorkspaceId] = useState(""),
    [region, setRegion] = useState("cn-beijing"),
    [realtimeModel, setRealtimeModel] = useState("qwen3.8-omni-flash-realtime"),
    [realtimeKey, setRealtimeKey] = useState(""),
    [hasRealtimeKey, setHasRealtimeKey] = useState(false);
  const [answerProvider, setAnswerProvider] = useState("api"),
    [codexModel, setCodexModel] = useState(""),
    [codexEffort, setCodexEffort] = useState(""),
    [codexModels, setCodexModels] = useState<any[]>([]),
    [codexStatus, setCodexStatus] = useState(""),
    [codexLoading, setCodexLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [modelName, setModelName] = useState("deepseek-flash");
  const [apiKey, setApiKey] = useState("");
  const [asrKey, setAsrKey] = useState("");
  const [asrModel, setAsrModel] = useState(
    "qwen-audio-3.1-asr-flash-streaming",
  );
  const [endpoint, setEndpoint] = useState(
    "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
  );
  const [hasModelKey, setHasModelKey] = useState(false);
  const [hasAsrKey, setHasAsrKey] = useState(false);
  const [mouseThrough, setMouseThrough] = useState(true);
  const [opacity, setOpacity] = useState(100);
  const [tab, setTab] = useState("model");
  const [testStatus, setTestStatus] = useState("");
  const [asrStatus, setAsrStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerStatus, setAnswerStatus] = useState("");
  const active = useRef<string | null>(null);
  const replaceOnToken = useRef(false);
  useEffect(() => {
    window.api
      ?.getSettings()
      .then((settings: any) => {
        const s = initialProfile
          ? {
              ...settings,
              ...initialProfile,
              baseUrl: initialProfile.model?.baseUrl ?? settings.baseUrl,
              modelName: initialProfile.model?.modelName ?? settings.modelName,
              asr: initialProfile.asr ?? null,
              hasModelKey: !!initialProfile.hasModelKey,
              hasAsrKey: !!initialProfile.hasAsrKey,
            }
          : settings;
        if (["timeout", "locked"].includes(s.vaultStatus))
          setTestStatus("密钥暂不可读取，请重试或检查钥匙串授权");
        setWorkspaceId(s.realtime?.workspaceId ?? "");
        setRegion(s.realtime?.region ?? "cn-beijing");
        setRealtimeModel(
          s.realtime?.modelName ?? "qwen3.8-omni-flash-realtime",
        );
        setHasRealtimeKey(!!s.hasRealtimeKey);
        setAnswerProvider(s.answerProvider ?? "api");
        setCodexModel(s.codex?.modelName ?? "");
        setCodexEffort(s.codex?.effort ?? "");
        setMouseThrough(s.mouseThrough ?? true);
        setBaseUrl(s.baseUrl);
        setModelName(s.modelName);
        setOpacity(Math.round(s.opacity * 100));
        setHasModelKey(!!s.hasModelKey);
        setHasAsrKey(!!s.hasAsrKey);
        if (s.asr) {
          setAsrModel(s.asr.modelName);
          setEndpoint(s.asr.endpoint);
          setAsrStatus("已配置 · 可开始实时转写");
        }
      })
      .catch(() => setTestStatus("读取配置失败"));
    const interaction = window.api?.onInteraction((state: any) =>
      setMouseThrough(state.enabled),
    );
    const answerUnsub = window.api?.onAnswer((e: any) => {
      if (e.status?.lane === "deep") return;
      if (e.status?.state === "started") {
        active.current = e.status.requestId;
        replaceOnToken.current = true;
        setAnswerStatus("生成中");
        return;
      }
      if (e.status?.requestId && e.status.requestId !== active.current) return;
      if (e.text) {
        const replace = replaceOnToken.current;
        replaceOnToken.current = false;
        setAnswer((prev) => (replace ? e.text : prev + e.text));
      }
      if (e.status?.state === "completed")
        setAnswerStatus(
          e.status.finishReason === "interrupted"
            ? "停止接收"
            : `完成 (${e.status.finishReason})`,
        );
      if (e.status?.state === "error")
        setAnswerStatus(`错误: ${e.status.error}`);
    });
    return () => {
      interaction?.();
      answerUnsub?.();
    };
  }, []);
  const refreshCodex = async () => {
    setCodexLoading(true);
    setCodexStatus("正在检查…");
    try {
      if (!window.api.codexStatus) throw Error("Codex客户端尚未启用");
      const r = await window.api.codexStatus();
      setCodexModels(r.models ?? []);
      setCodexStatus(
        r.signedIn ? "已连接 Codex" : "请先在Codex CLI或ChatGPT应用中登录",
      );
      setCodexModel((current) =>
        (r.models ?? []).some((m: any) => (m.model ?? m.id) === current)
          ? current
          : ((r.models ?? []).find((m: any) => m.isDefault)?.model ??
            (r.models ?? [])[0]?.model ??
            ""),
      );
    } catch (e: any) {
      setCodexStatus("连接失败：" + e.message);
    } finally {
      setCodexLoading(false);
    }
  };
  useEffect(() => {
    if (answerProvider === "codex") void refreshCodex();
  }, [answerProvider]);
  const selectedCodex = codexModels.find(
    (m) => (m.model ?? m.id) === codexModel,
  );
  const efforts = selectedCodex?.efforts ?? [];
  useEffect(() => {
    if (selectedCodex && !efforts.includes(codexEffort))
      setCodexEffort(selectedCodex.defaultReasoningEffort ?? efforts[0] ?? "");
  }, [codexModel, codexModels]);
  const modelPayload = () =>
    answerProvider === "realtime"
      ? {
          answerProvider,
          realtime: {
            workspaceId,
            region,
            modelName: realtimeModel,
            apiKey: realtimeKey || undefined,
          },
        }
      : answerProvider === "codex"
        ? {
            answerProvider,
            codex: { modelName: codexModel, effort: codexEffort },
          }
        : {
            answerProvider,
            model: { baseUrl, modelName, apiKey: apiKey || undefined },
          };
  const saveInFlight = useRef<Promise<any> | null>(null);
  const savePayload = () => {
    if (saveInFlight.current) return saveInFlight.current;
    const job = savePayloadNow();
    saveInFlight.current = job;
    void job
      .finally(() => {
        if (saveInFlight.current === job) saveInFlight.current = null;
      })
      .catch(() => {});
    return job;
  };
  const savePayloadNow = async () => {
    if (!initialProfile) return window.api.saveSettings(modelPayload());
    const r = await window.api.saveProfile({
      id: profileIdRef.current,
      name: profileName.trim(),
      ...modelPayload(),
      ...(answerProvider === "realtime"
        ? {}
        : {
            asr: {
              provider: "aliyun",
              endpoint,
              modelName: asrModel,
              language: "zh",
              apiKey: asrKey || undefined,
            },
          }),
    });
    profileIdRef.current = r.id;
    setProfileId(r.id);
    return r;
  };
  const saveModel = async () => {
    setTestStatus("正在保存…");
    try {
      const saved = await savePayload();
      if (answerProvider === "api" && apiKey) {
        setHasModelKey(true);
        setApiKey("");
      }
      if (realtimeKey) {
        setHasRealtimeKey(true);
        setRealtimeKey("");
      }
      setTestStatus(
        saved.persistent === false
          ? "配置已保存，密钥仅本次有效"
          : "配置已保存",
      );
      return true;
    } catch (e: any) {
      setTestStatus(`保存失败: ${e.message}`);
      return false;
    }
  };
  const modelTest = async () => {
    if (answerProvider === "codex") {
      if (await saveModel()) await refreshCodex();
      return;
    }
    setTestStatus("正在测试…");
    try {
      const saved = await savePayload();
      if (answerProvider === "api" && apiKey) {
        setHasModelKey(true);
        setApiKey("");
      }
      if (realtimeKey) {
        setHasRealtimeKey(true);
        setRealtimeKey("");
      }
      const res = await window.api.testProvider({
        kind: "model",
        profileId: saved.id ?? profileId,
      });
      setTestStatus(
        res.ok
          ? saved.persistent === false
            ? "连接成功（密钥仅本次运行有效）"
            : "连接成功"
          : `连接失败: ${res.error}`,
      );
    } catch (e: any) {
      setTestStatus(`错误: ${e.message}`);
    }
  };
  const saveAsr = async () => {
    try {
      const saved = initialProfile
        ? await savePayload()
        : await window.api.saveSettings({
            asr: {
              provider: "aliyun",
              endpoint,
              modelName: asrModel,
              language: "zh",
              apiKey: asrKey || undefined,
            },
          });
      if (asrKey) {
        setHasAsrKey(true);
        setAsrKey("");
      }
      setAsrStatus(
        saved.asrPersistent === false
          ? "已配置 · 密钥仅本次有效 · 可开始实时转写"
          : "已配置 · 可开始实时转写",
      );
    } catch (e: any) {
      setAsrStatus(`保存失败: ${e.message}`);
    }
  };
  const changeOpacity = async (value: number) => {
    setOpacity(value);
    try {
      await window.api.sendWindowCommand({
        action: "set_opacity",
        opacity: value / 100,
      });
    } catch {
      setTestStatus("透明度保存失败");
    }
  };
  const ask = async () => {
    if (!question.trim() || !(await saveModel())) return;
    if (initialProfile) {
      try {
        await window.api.selectProfile(profileIdRef.current);
      } catch (e: any) {
        setAnswerStatus(e.message);
        return;
      }
    }
    setAnswerStatus("发送请求中…");
    try {
      await window.api.askAnswer({ question });
    } catch (e: any) {
      setAnswerStatus(`提问失败: ${e.message}`);
    }
  };
  const cancel = async () => {
    try {
      await window.api.cancelAnswer();
      setAnswerStatus("停止接收");
    } catch (e: any) {
      setAnswerStatus(`取消失败: ${e.message}`);
    }
  };
  const jump = (id: string) => {
    setTab(id);
    document
      .getElementById(id)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <div ref={dragRef} className="shell settings-shell">
      <div className="glass">
        <header className="titlebar">
          <span>设置</span>
          <div className="controls">
            <button
              className="icon-btn"
              aria-label="最小化"
              onClick={() =>
                window.api.sendWindowCommand({ action: "minimize_prepare" })
              }
            >
              −
            </button>
            <button
              className="icon-btn"
              aria-label="完全退出"
              title="停止采集、保存会话并退出"
              onClick={() =>
                window.api.sendWindowCommand({ action: "quit_app" })
              }
            >
              ×
            </button>
          </div>
        </header>
        {!initialProfile?.appearanceOnly && (
          <div className="prep-navigation">
            <nav className="tabs">
              {[
                ["model", "模型配置"],
                ["voice", "语音设置"],
                ["appearance", "窗口设置"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => jump(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        )}
        <main className="content">
          {!initialProfile?.appearanceOnly && (
            <section className="section" id="model">
              <div className="section-head">
                <h2>模型配置与手动提问</h2>
              </div>
              {initialProfile && (
                <label className="field">
                  <span>方案名称</span>
                  <input
                    aria-label="方案名称"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="给方案起个名称"
                  />
                </label>
              )}
              <label className="field">
                <span>回答后端</span>
                <select
                  aria-label="回答后端"
                  value={answerProvider}
                  onChange={(e) => setAnswerProvider(e.target.value)}
                >
                  <option value="api">自定义 API</option>
                  <option value="codex">Codex</option>
                  <option value="realtime">Qwen 实时语音</option>
                </select>
              </label>
              {answerProvider === "api" ? (
                <>
                  {" "}
                  <label className="field">
                    <span>Base URL</span>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        hasModelKey
                          ? "已保存 · 留空保持现有密钥"
                          : "输入 API Key"
                      }
                    />
                  </label>
                  <label className="field">
                    <span>模型名称</span>
                    <input
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                    />
                  </label>
                </>
              ) : answerProvider === "realtime" ? (
                <>
                  <label className="field">
                    <span>业务空间 ID</span>
                    <input
                      aria-label="业务空间 ID"
                      value={workspaceId}
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      placeholder="llm-…"
                    />
                  </label>
                  <label className="field">
                    <span>地域</span>
                    <select
                      aria-label="地域"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                    >
                      <option value="cn-beijing">北京</option>
                      <option value="ap-southeast-1">新加坡</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>实时模型</span>
                    <input
                      aria-label="实时模型"
                      value={realtimeModel}
                      onChange={(e) => setRealtimeModel(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>阿里 API Key</span>
                    <input
                      type="password"
                      value={realtimeKey}
                      onChange={(e) => setRealtimeKey(e.target.value)}
                      placeholder={
                        hasRealtimeKey
                          ? "已保存 · 留空保持现有密钥"
                          : "输入 API Key"
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Codex 模型</span>
                    <select
                      aria-label="Codex 模型"
                      value={codexModel}
                      onChange={(e) => setCodexModel(e.target.value)}
                      disabled={codexLoading || !codexModels.length}
                    >
                      <option value="">模型默认</option>
                      {codexModels.map((m) => (
                        <option key={m.id} value={m.model ?? m.id}>
                          {m.displayName ?? m.model ?? m.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>思考强度</span>
                    <select
                      aria-label="思考强度"
                      value={codexEffort}
                      onChange={(e) => setCodexEffort(e.target.value)}
                      disabled={codexLoading || !efforts.length}
                    >
                      <option value="">模型默认</option>
                      {efforts.map((e: string) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="status" role="status">
                    {codexStatus}
                  </p>
                </>
              )}
              <div className="row">
                <button className="button primary" onClick={saveModel}>
                  保存配置
                </button>
                <button className="button" onClick={modelTest}>
                  {answerProvider === "codex" ? "检查连接" : "保存并测试连接"}
                </button>
                <span className="status" role="status">
                  {testStatus}
                </span>
              </div>
              <div className="divider" />
              <h3>提问测试</h3>
              <textarea
                aria-label="问题"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="输入你的问题…"
              />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="button primary" onClick={ask}>
                  发送提问
                </button>
                <button className="button" onClick={cancel}>
                  停止接收
                </button>
                <span className="status">{answerStatus}</span>
              </div>
              <div className="answer">
                {answer ? (
                  <MarkdownAnswer text={answer} />
                ) : (
                  <span className="status">等待回答...</span>
                )}
              </div>
            </section>
          )}
          {!initialProfile?.appearanceOnly && answerProvider !== "realtime" && (
            <section className="section" id="voice">
              <div className="section-head">
                <h3>语音识别</h3>
              </div>

              <label className="field">
                <span>ASR 模型</span>
                <input
                  value={asrModel}
                  onChange={(e) => setAsrModel(e.target.value)}
                />
              </label>
              <label className="field">
                <span>WebSocket 接口</span>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
              <label className="field">
                <span>阿里 API Key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={asrKey}
                  onChange={(e) => setAsrKey(e.target.value)}
                  placeholder={
                    hasAsrKey ? "已保存 · 留空保持现有密钥" : "输入 API Key"
                  }
                />
              </label>
              <div className="row">
                <button className="button" onClick={saveAsr}>
                  保存 ASR 配置
                </button>
                <button
                  className="button"
                  onClick={async () => {
                    setAsrStatus("正在测试…");
                    try {
                      await saveAsr();
                      const result = await window.api.testProvider({
                        kind: "asr",
                        profileId,
                      });
                      setAsrStatus(
                        result.ok
                          ? "ASR 连接成功"
                          : `ASR 连接失败: ${result.error}`,
                      );
                    } catch (e: any) {
                      setAsrStatus(e.message);
                    }
                  }}
                >
                  测试 ASR 连接
                </button>
                <span className="status">{asrStatus}</span>
              </div>
            </section>
          )}
          <section className="section" id="appearance">
            <div className="section-head">
              <h3>窗口外观</h3>
            </div>
            <div className="setting-row">
              <div>
                <strong>窗口不透明度</strong>
              </div>
              <div className="range">
                <input
                  aria-label="窗口不透明度"
                  type="range"
                  min="0"
                  max="100"
                  value={opacity}
                  onChange={(e) => void changeOpacity(Number(e.target.value))}
                />
                <output>{opacity}%</output>
              </div>
            </div>
            <label className="setting-row">
              <span>辅助浮窗鼠标穿透（按住 ⌥ 操作）</span>
              <input
                aria-label="鼠标穿透"
                type="checkbox"
                checked={mouseThrough}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  try {
                    await window.api.sendWindowCommand({
                      action: "set_mouse_through",
                      enabled,
                    });
                    setMouseThrough(enabled);
                  } catch {
                    setTestStatus("穿透设置保存失败");
                  }
                }}
              />
            </label>
          </section>
          <section className="section">
            <h3>诊断日志</h3>
            <button
              className="button"
              onClick={async () => {
                try {
                  await window.api.diagnostics("open");
                } catch {
                  setTestStatus("日志目录打开失败");
                }
              }}
            >
              打开日志目录
            </button>
          </section>
        </main>
        <footer className="footer">
          <button className="button primary" onClick={onBack}>
            ← 返回方案
          </button>
        </footer>
      </div>
    </div>
  );
}
