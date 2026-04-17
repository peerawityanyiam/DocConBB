export function generateRequestId(): string {
  const fromWebCrypto = globalThis.crypto?.randomUUID?.();
  if (fromWebCrypto) return fromWebCrypto;
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getRequestIdFromHeaders(headers: Pick<Headers, 'get'>): string {
  const incoming = headers.get('x-request-id')?.trim();
  return incoming && incoming.length > 0 ? incoming : generateRequestId();
}

type LogLevel = 'info' | 'warn' | 'error';

export function logEvent(
  level: LogLevel,
  scope: string,
  requestId: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope,
    requestId,
    message,
    ...(meta ?? {}),
  };
  const text = JSON.stringify(payload);
  if (level === 'error') {
    console.error(text);
    return;
  }
  if (level === 'warn') {
    console.warn(text);
    return;
  }
  console.log(text);
}
