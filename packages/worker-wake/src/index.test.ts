import {afterEach, expect, it, vi} from 'vitest';
import {parseWakeKeys, signWake, verifyWake, readWakeBody, wakeEndpoint} from './index.js';
const source = `current=${btoa('a'.repeat(32))},old=${btoa('b'.repeat(32))}`;
afterEach(() => vi.useRealTimers());

it('authenticates exact protocol bytes, key rotation and freshness in both directions', async () => {
  const keys = await parseWakeKeys(source), now = 1_800_000_000_000;
  for (const id of ['current', 'old']) {
    const signature = await signWake(keys, id, now);
    expect(await verifyWake(signature, keys, now)).toMatch(new RegExp(`^${id}:`));
    expect(await verifyWake(signature, keys, now + 61_000)).toBeNull();
    expect(await verifyWake(signature, keys, now - 61_000)).toBeNull();
    for (const forged of [signature.replace(/^v1/, 'v2'), signature.replace(id, 'unknown'), signature.slice(0,-1)+'g', signature+'x', signature.replace(/.$/, signature.endsWith('0')?'1':'0')]) {
      expect(await verifyWake(forged, keys, now)).toBeNull();
    }
    expect(await verifyWake(signature, await parseWakeKeys(`current=${btoa('c'.repeat(32))}`), now)).toBeNull();
  }
});

it('rejects malformed, duplicated and short keys with a sanitized error', async () => {
  for (const config of ['', 'secret', 'bad=not-base64!', `one=${btoa('short')}`, `${source},current=${btoa('a'.repeat(32))}`]) {
    await expect(parseWakeKeys(config)).rejects.toThrow('Invalid worker wake key configuration.');
  }
});

it('bounds streamed bytes without Content-Length and cancels oversized/stalled input', async () => {
  expect(await readWakeBody(new Response('{}').body)).toBe(true);
  expect(await readWakeBody(new Response('{ }').body)).toBe(false);
  expect(await readWakeBody(null)).toBe(false);
  const cancel = vi.fn();
  expect(await readWakeBody(new ReadableStream({start(c) { c.enqueue(new Uint8Array(10000)); }, cancel}))).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  const stalled = readWakeBody(new ReadableStream({cancel}));
  await vi.advanceTimersByTimeAsync(2000);
  expect(await stalled).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('requires a fixed HTTPS hostname endpoint, never credentials, queries or IP literals', () => {
  expect(wakeEndpoint('https://wake.example.test/wake').pathname).toBe('/wake');
  for (const url of ['http://wake.example.test/wake','https://wake.example.test/wake?url=x','https://wake.example.test/wake#x','https://user:secret@wake.example.test/wake','https://[2001:db8::1]/wake','https://127.0.0.1/wake','https://placeholder.invalid/wake','https://wake.example.test/other']) expect(() => wakeEndpoint(url)).toThrow();
});
