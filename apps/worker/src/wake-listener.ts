import {createServer, type Server} from 'node:http';
import {WAKE_BODY, WAKE_HEADER, WAKE_PATH, WAKE_WINDOW_SECONDS, verifyWake, type WakeKeys} from '@sportos/worker-wake';

/** Loopback only. nginx supplies TLS; neither this listener nor liveness uses SQL. */
export function createWakeListener(keys: WakeKeys, wake: () => void): Server {
  const seen = new Map<string, number>();
  let nextAllowed = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const server = createServer({maxHeaderSize: 4096}, (request, response) => {
    const reply = (status: number) => { response.writeHead(status, {'cache-control': 'no-store', 'connection': 'close'}); response.end(); };
    void (async () => {
      if (request.method !== 'POST' || request.url !== WAKE_PATH || request.headers.host !== 'localhost') { reply(404); return; }
      const header = request.headers[WAKE_HEADER];
      const nonce = await verifyWake(typeof header === 'string' ? header : null, keys);
      if (!nonce) { reply(401); return; }
      let body = '';
      for await (const chunk of request.iterator({destroyOnReturn: false})) {
        if (Buffer.byteLength(body) + chunk.length > 2) { reply(413); return; }
        body += chunk.toString('utf8');
      }
      if (body !== WAKE_BODY) { reply(400); return; }
      const now = Date.now();
      for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
      if (seen.has(nonce)) { reply(202); return; }
      if (seen.size >= 256) { reply(429); return; }
      seen.set(nonce, now + (2 * WAKE_WINDOW_SECONDS + 1) * 1000);
      if (now < nextAllowed) {
        // Coalesce rather than drop a valid hint committed just after the last scan.
        pending ??= setTimeout(() => { pending = undefined; nextAllowed = Date.now() + 2000; wake(); }, nextAllowed - now);
      } else { nextAllowed = now + 2000; wake(); }
      reply(202);
    })().catch(() => { if (!response.headersSent) reply(400); else response.end(); });
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  server.timeout = 3000;
  server.on('timeout', socket => socket.destroy());
  server.once('close', () => clearTimeout(pending));
  return server;
}
