export interface ThinkingOptions {
 thinking?: 'enabled' | 'disabled';
 reasoningEffort?: 'low' | 'max';
}

/** Vendor extensions are sent only to DeepSeek's own API and model names. */
export function resolveThinking(baseUrl: string, modelName: string, _mode: string | undefined, _question: string, hasScreenshot = false): ThinkingOptions {
 try {
  if (new URL(baseUrl).hostname !== 'api.deepseek.com' || !modelName.startsWith('deepseek-')) return {};
 } catch { return {}; }
 return {thinking: 'enabled', reasoningEffort: hasScreenshot ? 'max' : 'low'};
}

/** Only a speaker's own explicit correction prefix supersedes an active answer. */
export function isExplicitCorrection(text: string): boolean {
 const value=text.trimStart();
 if(/^(?:不是(?:所有|每|很|特别|一般|通常|什么)|不对称)/.test(value))return false;
 return /^(?:不是|不对|纠正|更正|我说的是|我的意思是|补充一下|补充条件|改成)/.test(value);
}

type AnswerProvider='api'|'codex'|'realtime';
export function resolveAnswerProvider(provider:AnswerProvider,hasScreenshot:boolean):AnswerProvider {
 return provider==='realtime'&&hasScreenshot?'api':provider;
}
export function resolveAnswerThinking(provider:AnswerProvider,baseUrl:string,modelName:string,hasScreenshot:boolean):ThinkingOptions {
 return resolveAnswerProvider(provider,hasScreenshot)==='api'?resolveThinking(baseUrl,modelName,undefined,'',hasScreenshot):{};
}
