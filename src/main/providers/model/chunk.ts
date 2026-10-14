export type FinishReason = 'done' | 'stop' | 'length' | 'content_filter' | 'interrupted';

export interface DecodedChunk {
  text: string;
  reasoningChars?:number;
  finish: FinishReason | null;
}

export function decodeChunk(data: string): DecodedChunk {
  const trimmed = data.trim();
  if (trimmed === '[DONE]') {
    return { text: '', finish: 'done' };
  }

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error('INVALID_JSON');
  }

  if (obj && typeof obj === 'object' && obj.error) {
    const msg = typeof obj.error === 'string' ? obj.error : obj.error.message || 'PROVIDER_ERROR';
    throw new Error(`PROVIDER_ERROR: ${msg}`);
  }

  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.choices)) {
    throw new Error('INVALID_CHUNK');
  }

  if (obj.choices.length === 0) {
    return { text: '', finish: null };
  }

  const choice = obj.choices[0];
  if (!choice || typeof choice !== 'object') {
    throw new Error('INVALID_CHUNK');
  }

  if (choice.delta?.tool_calls || choice.finish_reason === 'tool_calls') {
    throw new Error('UNSUPPORTED_OUTPUT: tool_calls');
  }

  const text = choice.delta?.content;
  if (text !== undefined && text !== null && typeof text !== 'string') {
    throw new Error('INVALID_CONTENT');
  }

  let finish: FinishReason | null = null;
  const rawFinish = choice.finish_reason;
  if (rawFinish === 'stop') {
    finish = 'stop';
  } else if (rawFinish === 'length') {
    finish = 'length';
  } else if (rawFinish === 'content_filter') {
    finish = 'content_filter';
  } else if (rawFinish != null && rawFinish !== '') {
    finish = 'stop';
  }

  return {
    text: text ?? '',
    ...(typeof choice.delta?.reasoning_content==='string'?{reasoningChars:choice.delta.reasoning_content.length}:{}),
    finish
  };
}
