/** Server/edge transport only. No account, provider or database dependencies. */
export const WAKE_PATH = '/wake';
export const WAKE_BODY = '{}';
export const WAKE_HEADER = 'x-sportos-wake';
export const WAKE_WINDOW_SECONDS = 60;
export type WakeKeys = ReadonlyMap<string, CryptoKey>;
const encoder = new TextEncoder();

export async function parseWakeKeys(value: string): Promise<WakeKeys> {
  const keys = new Map<string, CryptoKey>();
  try {
    const entries = value.split(',');
    if (entries.length > 3) throw new Error();
    for (const entry of entries) {
      const split = entry.indexOf('=');
      const id = entry.slice(0, split);
      if (split < 1 || !/^[a-zA-Z0-9_-]{1,32}$/.test(id) || keys.has(id)) throw new Error();
      const bytes = Uint8Array.from(atob(entry.slice(split + 1)), c => c.charCodeAt(0));
      if (bytes.length !== 32) throw new Error();
      keys.set(id, await crypto.subtle.importKey('raw', bytes, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']));
    }
    return keys;
  } catch { throw new Error('Invalid worker wake key configuration.'); }
}

function message(id: string, time: string, nonce: string): Uint8Array {
  return encoder.encode(`v1\nPOST\n${WAKE_PATH}\n${id}\n${time}\n${nonce}\n${WAKE_BODY}`);
}

export async function signWake(keys: WakeKeys, id: string, now = Date.now(), nonce = crypto.randomUUID()): Promise<string> {
  const key = keys.get(id);
  if (!key) throw new Error('Worker wake signing key is unavailable.');
  const time = String(Math.floor(now / 1000));
  const signature = await crypto.subtle.sign('HMAC', key, message(id, time, nonce));
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  return `v1.${id}.${time}.${nonce}.${hex}`;
}

export async function verifyWake(header: string | null, keys: WakeKeys, now = Date.now()): Promise<string | null> {
  if (!header || header.length > 180) return null;
  const match = /^v1\.([a-zA-Z0-9_-]{1,32})\.([0-9]{1,12})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/.exec(header);
  if (!match) return null;
  const [,id,time,nonce,hex] = match;
  const key = keys.get(id);
  if (!key || Math.abs(Math.floor(now / 1000) - Number(time)) > WAKE_WINDOW_SECONDS) return null;
  const signature = Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16));
  return await crypto.subtle.verify('HMAC', key, signature, message(id, time, nonce)) ? `${id}:${nonce}` : null;
}

/** Enforce actual streamed bytes, never trust Content-Length alone. */
export async function readWakeBody(body: ReadableStream<Uint8Array> | null): Promise<boolean> {
  if (!body) return false;
  const reader = body.getReader();
  let result = '';
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 2000);
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return !expired && result === WAKE_BODY;
      if (!value) continue;
      if (value.length + result.length > 2) { await reader.cancel(); return false; }
      result += String.fromCharCode(...value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function wakeEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== WAKE_PATH ||
    url.hostname.endsWith('.invalid') || url.hostname.startsWith('[') || /^[0-9.]+$/.test(url.hostname)) {
    throw new Error('Invalid worker wake HTTPS endpoint.');
  }
  return url;
}
