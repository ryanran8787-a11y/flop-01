/**
 * CSP 字串建構（純函數）。嚴格 CSP：
 * - 腳本/樣式只允許 self（Vite dev 另行放寬，見註解）
 * - 連線只允許 self + 127.0.0.1（Ollama HTTP + sidecar WS）
 */
export function buildCsp(ollamaHttpOrigin: string, dev = false): string {
  const scriptSrc = dev ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'";
  const connectSrc = `'self' asset: http://127.0.0.1:* ws://127.0.0.1:* ${ollamaHttpOrigin}`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}
