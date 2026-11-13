import {afterEach,describe,expect,it,vi} from 'vitest';
import {BadRequestException,NotFoundException} from '@nestjs/common';
import {DailyRecalculationError,DailyRecalculationRepository} from '@sportos/db';
import {DailyRecalculationController} from './daily-recalculation.controller.js';
const owner={id:'00000000-0000-4000-8000-000000000001',displayName:'Synthetic',email:null};
const id='00000000-0000-4000-8000-000000000002';
function setup(){const withAccount=vi.fn(async(_id:string,fn:(db:unknown)=>unknown)=>fn({}));return {withAccount,controller:new DailyRecalculationController({withAccount} as never)}}
afterEach(()=>vi.restoreAllMocks());
describe('explicit bulk daily calculation API',()=>{
 it('uses only the authenticated owner and server-derived range',async()=>{
  const {controller,withAccount}=setup();const state=vi.spyOn(DailyRecalculationRepository.prototype,'state').mockResolvedValue({} as never);
  const enqueue=vi.spyOn(DailyRecalculationRepository.prototype,'enqueue').mockResolvedValue({id} as never);
  await controller.state(owner);await controller.start({},owner);expect(withAccount.mock.calls.every(([account])=>account===owner.id)).toBe(true);expect(state).toHaveBeenCalledOnce();expect(enqueue).toHaveBeenCalledWith();
 });
 it('rejects supplied dates, owners, cursors, malformed bodies and job identifiers before database access',()=>{
  const {controller,withAccount}=setup();for(const body of [null,[],{ownerId:owner.id},{from:'2026-11-04'},{cursor:'2026-11-04'},{timeZone:'UTC'}])expect(()=>controller.start(body,owner)).toThrow(BadRequestException);
  expect(()=>controller.get('invalid',owner)).toThrow(BadRequestException);expect(()=>controller.retry(id,{date:'2026-11-04'},owner)).toThrow(BadRequestException);expect(withAccount).not.toHaveBeenCalled();
 });
 it('returns identical not-found responses for foreign/missing reads, cancellation and retry',async()=>{
  const {controller}=setup();vi.spyOn(DailyRecalculationRepository.prototype,'get').mockResolvedValue(null);vi.spyOn(DailyRecalculationRepository.prototype,'cancel').mockResolvedValue(null);vi.spyOn(DailyRecalculationRepository.prototype,'retry').mockRejectedValue(new DailyRecalculationError('NOT_FOUND'));
  for(const request of [()=>controller.get(id,owner),()=>controller.cancel(id,{},owner),()=>controller.retry(id,{},owner)])await expect(request()).rejects.toBeInstanceOf(NotFoundException);
 });
});
