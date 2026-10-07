import { describe, expect, it, vi } from 'vitest';
import { GarminDayController } from './garmin-day.controller.js';
const account = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Test', email: null };
function setup() {
  const service = { read: vi.fn(), resource: vi.fn(), fetch: vi.fn() };
  return { service, controller: new GarminDayController(service as never) };
}
describe('Garmin day request boundary', () => {
  it('GET selects only retained data and derives owner from account', () => {
    const { service, controller } = setup(); controller.read('2026-03-29', account);
    expect(service.read).toHaveBeenCalledWith(account.id,'2026-03-29'); expect(service.fetch).not.toHaveBeenCalled();
    controller.resource('2026-03-29','weight',account); expect(service.resource).toHaveBeenCalledWith(account.id,'2026-03-29','weight');
  });
  it('POST allows only refresh boolean and rejects private internals', async () => {
    const { service, controller } = setup();
    for (const input of [{ownerId:account.id},{refresh:'true'},{password:'secret'},{path:'/private'},[],null]) {
      if (input === null) continue;
      await expect(controller.fetch('2026-03-29',input,account)).rejects.toMatchObject({status:400});
    }
    expect(service.fetch).not.toHaveBeenCalled();
    await controller.fetch('2026-03-29',{refresh:true},account);
    expect(service.fetch).toHaveBeenCalledWith(account,'2026-03-29',true,expect.any(AbortSignal));
  });
  it('rejects malformed/future dates and arbitrary categories before any work', async () => {
    const { service, controller } = setup();
    expect(() => controller.read('2026-02-30',account)).toThrow();
    expect(() => controller.resource('2026-03-29','credentials',account)).toThrow();
    await expect(controller.fetch('2099-01-01',{},account)).rejects.toMatchObject({status:400});
    expect(service.fetch).not.toHaveBeenCalled();
  });
  it('disconnect cancels the underlying helper', async () => {
    const { service, controller } = setup(); let close: (()=>void) | undefined;
    service.fetch.mockImplementation(async (_owner,_date,_refresh, signal: AbortSignal) => { close?.(); expect(signal.aborted).toBe(true); });
    await controller.fetch('2026-03-29',{},account,undefined,{on: (_event,listener) => {close=listener;},off:vi.fn()});
  });
});
