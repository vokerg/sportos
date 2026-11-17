import {parseWakeKeys, readWakeBody, verifyWake, WAKE_BODY, WAKE_HEADER, WAKE_PATH, type WakeKeys} from '../../packages/worker-wake/src/index.js';

interface Environment { PUBLIC_ORIGIN: string; UPSTREAM_WAKE_URL: string; WAKE_KEYS: string; }
let cached: {source: string; keys: Promise<WakeKeys>} | undefined;
const reply = (status: number) => new Response(null, {status, headers: {'cache-control': 'no-store'}});

/** A separate, fixed-route gateway. Never an arbitrary proxy or job producer. */
export async function proxy(request: Request, env: Environment, fetchOrigin: typeof fetch = fetch): Promise<Response> {
  try {
    const publicOrigin = new URL(env.PUBLIC_ORIGIN), upstream = new URL(env.UPSTREAM_WAKE_URL);
    if (publicOrigin.origin !== env.PUBLIC_ORIGIN || publicOrigin.protocol !== 'https:' || publicOrigin.username || publicOrigin.password ||
      publicOrigin.hostname.endsWith('.invalid') || upstream.protocol !== 'https:' || upstream.username || upstream.password ||
      upstream.hostname.startsWith('[') || /^[0-9.]+$/.test(upstream.hostname) || upstream.hostname.endsWith('.invalid') ||
      upstream.pathname !== '/sportos-worker/wake' || upstream.search || upstream.hash || upstream.origin === publicOrigin.origin) return reply(503);
    const url = new URL(request.url);
    if (url.origin !== publicOrigin.origin || url.pathname !== WAKE_PATH || url.search || request.method !== 'POST') return reply(404);
    if (!cached || cached.source !== env.WAKE_KEYS) cached = {source: env.WAKE_KEYS, keys: parseWakeKeys(env.WAKE_KEYS)};
    const header = request.headers.get(WAKE_HEADER);
    if (!await verifyWake(header, await cached.keys)) return reply(401);
    if (!await readWakeBody(request.body)) return reply(400);
    const response = await fetchOrigin(upstream, {
      method: 'POST', headers: {[WAKE_HEADER]: header!, 'content-type': 'application/json'}, body: WAKE_BODY,
      redirect: 'manual', signal: AbortSignal.timeout(2000),
    });
    await response.body?.cancel();
    return reply(response.status === 202 ? 202 : response.status === 429 ? 429 : 502);
  } catch { return reply(502); }
}

export default {fetch(request: Request, env: Environment) { return proxy(request, env); }};
