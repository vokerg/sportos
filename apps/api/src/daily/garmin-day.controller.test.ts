import {describe,expect,it,vi} from 'vitest';
import {GarminDayController} from './garmin-day.controller.js';
const account={id:'11111111-1111-4111-8111-111111111111',displayName:'Test',email:null};
function setup(){const service={read:vi.fn(),resource:vi.fn(),fetch:vi.fn()};return{service,controller:new GarminDayController(service as never)}}
describe('Garmin day queue request boundary',()=>{
 it('enqueues only the authenticated owner and allowed refresh flag',async()=>{const {service,controller}=setup();await controller.fetch('2026-03-29',{refresh:true},account);expect(service.fetch).toHaveBeenCalledWith(account,'2026-03-29',true)});
 it('GET stays read-only and categories are allowlisted',()=>{const{service,controller}=setup();controller.read('2026-03-29',account);expect(service.read).toHaveBeenCalledWith(account.id,'2026-03-29');expect(service.fetch).not.toHaveBeenCalled();expect(()=>controller.resource('2026-03-29','credentials',account)).toThrow()});
 it('rejects owners, paths, passwords and malformed dates before queueing',async()=>{const{service,controller}=setup();for(const body of [{ownerId:account.id},{refresh:'true'},{password:'secret'},{path:'/private'},[]])await expect(controller.fetch('2026-03-29',body,account)).rejects.toMatchObject({status:400});await expect(controller.fetch('2026-02-30',{},account)).rejects.toMatchObject({status:400});expect(service.fetch).not.toHaveBeenCalled()});
 it('disconnecting an HTTP request does not cancel durable work',async()=>{const{service,controller}=setup();const on=vi.fn(),off=vi.fn();await controller.fetch('2026-03-29',{},account,{on,off},{on,off});expect(on).not.toHaveBeenCalled();expect(service.fetch).toHaveBeenCalledWith(account,'2026-03-29',false)});
});
