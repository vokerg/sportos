import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestDatabase, withRequestDatabases } from './request-databases.js';

const mocks = vi.hoisted(() => ({ createDb: vi.fn() }));
vi.mock('@sportos/db', () => ({ createDb: mocks.createDb }));

function pool(isTransaction: boolean) {
  return { isTransaction, destroy: vi.fn(async () => {}) };
}

describe('request-owned database pools', () => {
  afterEach(() => mocks.createDb.mockReset());

  it('keeps different invocations and database targets isolated', async () => {
    const first = pool(true);
    const second = pool(false);
    const detailPool = pool(false);
    mocks.createDb.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(detailPool);

    const primary = createRequestDatabase('synthetic-primary');
    const detail = createRequestDatabase('synthetic-detail');
    await Promise.all([
      withRequestDatabases(async () => {
        expect(primary.isTransaction).toBe(true);
        await Promise.resolve();
        expect(primary.isTransaction).toBe(true);
        expect(detail.isTransaction).toBe(false);
      }),
      withRequestDatabases(async () => {
        expect(primary.isTransaction).toBe(false);
        await Promise.resolve();
        expect(primary.isTransaction).toBe(false);
      }),
    ]);
    expect(mocks.createDb.mock.calls).toEqual([
      ['synthetic-primary', { max: 2 }],
      ['synthetic-primary', { max: 2 }],
      ['synthetic-detail', { max: 2 }],
    ]);
    for (const opened of [first, second, detailPool]) expect(opened.destroy).toHaveBeenCalledOnce();
    expect(() => primary.isTransaction).toThrow('Request database scope is unavailable.');
  });

  it('releases opened pools when a request fails', async () => {
    const opened = pool(false);
    mocks.createDb.mockReturnValue(opened);
    await expect(withRequestDatabases(async () => {
      expect(createRequestDatabase('synthetic-primary').isTransaction).toBe(false);
      throw new Error('failed request');
    })).rejects.toThrow('failed request');
    expect(opened.destroy).toHaveBeenCalledOnce();
  });
});
