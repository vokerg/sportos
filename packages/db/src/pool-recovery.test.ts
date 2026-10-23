import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { sql } from 'kysely';
import { expect, it, vi } from 'vitest';
import { createDb } from './pool.js';

// A tiny PostgreSQL wire peer exercises the real pg pool/Kysely lifecycle without
// credentials or a live database. It supports startup and simple SELECT only.
function message(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeInt32BE(payload.length + 4);
  return Buffer.concat([Buffer.from(type), length, payload]);
}

it('survives idle and checked-out socket loss and replaces both clients', async () => {
  const sockets = new Set<Socket>();
  let latest: Socket;
  let accepted = 0;
  let dropQuery = false;
  const server = createServer((socket) => {
    accepted++;
    latest = socket;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let startup = true;
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= (startup ? 4 : 5)) {
        const size = pending.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
        if (pending.length < size) return;
        const type = String.fromCharCode(pending[0]);
        pending = pending.subarray(size);
        if (startup) {
          startup = false;
          socket.write(Buffer.concat([message('R', Buffer.alloc(4)), message('Z', Buffer.from('I'))]));
        } else if (type === 'Q') {
          if (dropQuery) { dropQuery = false; socket.destroy(); return; }
          socket.write(Buffer.concat([message('C', Buffer.from('SELECT 0\0')), message('Z', Buffer.from('I'))]));
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const db = createDb(`postgresql://test@127.0.0.1:${address.port}/test?sslmode=disable`);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await sql`select 1`.execute(db);
    latest!.destroy();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await sql`select 1`.execute(db);
    expect(accepted).toBe(2);
    await db.connection().execute(async (connection) => {
      await sql`select 1`.execute(connection);
      latest!.destroy();
      // The socket error arrives between queries on the reserved connection.
      await vi.waitFor(async () => {
        await expect(sql`select 1`.execute(connection)).rejects.toThrow(/connection|queryable/i);
      });
    });
    await sql`select 1`.execute(db);
    expect(accepted).toBe(3);
    dropQuery = true;
    await expect(sql`select 1`.execute(db)).rejects.toThrow(/connection/i);
    await sql`select 1`.execute(db);
    expect(accepted).toBe(4);
    expect(warn.mock.calls.every((args) => args.length === 1 && typeof args[0] === 'string')).toBe(true);
  } finally {
    warn.mockRestore();
    await db.destroy();
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, 'close');
  }
});
