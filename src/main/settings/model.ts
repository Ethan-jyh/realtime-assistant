export function completionUrl(base: string): string {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error('INVALID_PREFIX');
  }

  if (u.username || u.password || u.search || u.hash) {
    throw new Error('INVALID_PREFIX');
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('HTTPS_REQUIRED');
  }

  const cleanPath = u.pathname.replace(/\/+$/, '');
  if (cleanPath.endsWith('/chat/completions')) {
    u.pathname = cleanPath;
  } else {
    u.pathname = `${cleanPath}/chat/completions`;
  }

  return u.toString();
}

export interface ModelSettings {
  baseUrl: string;
  apiKey?: string;
  modelName: string;
}
