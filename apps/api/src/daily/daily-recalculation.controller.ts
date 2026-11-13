import {BadRequestException,Body,ConflictException,Controller,Get,HttpCode,NotFoundException,Param,Post} from '@nestjs/common';
import {DailyRecalculationError,DailyRecalculationRepository} from '@sportos/db';
import {CurrentAccount} from '../auth/current-account.decorator.js';
import type {AuthenticatedAccount} from '../auth/auth.models.js';
import {DbProvider} from '../db.provider.js';
import {assertUuid} from '../query-validation.js';

@Controller('daily/recalculation')
export class DailyRecalculationController {
 constructor(private readonly db:DbProvider){}
 @Get() state(@CurrentAccount() account:AuthenticatedAccount){return this.execute(account,repo=>repo.state())}
 @Post() @HttpCode(202)
 start(@Body() body:unknown,@CurrentAccount() account:AuthenticatedAccount){empty(body);return this.execute(account,repo=>repo.enqueue())}
 @Get('jobs/:id')
 get(@Param('id') id:string,@CurrentAccount() account:AuthenticatedAccount){assertUuid(id,'INVALID_JOB_ID');return this.execute(account,repo=>repo.get(id))}
 @Post('jobs/:id/cancel') @HttpCode(202)
 cancel(@Param('id') id:string,@Body() body:unknown,@CurrentAccount() account:AuthenticatedAccount){assertUuid(id,'INVALID_JOB_ID');empty(body);return this.execute(account,repo=>repo.cancel(id))}
 @Post('jobs/:id/retry') @HttpCode(202)
 retry(@Param('id') id:string,@Body() body:unknown,@CurrentAccount() account:AuthenticatedAccount){assertUuid(id,'INVALID_JOB_ID');empty(body);return this.execute(account,repo=>repo.retry(id))}
 private async execute<T>(account:AuthenticatedAccount,fn:(repo:DailyRecalculationRepository)=>Promise<T>){
  try{
   const result=await this.db.withAccount(account.id,db=>fn(new DailyRecalculationRepository(db)));
   if(result===null)throw new NotFoundException('Calculation job was not found.');return result;
  }catch(error){
   if(error instanceof DailyRecalculationError){
    if(error.code==='NOT_FOUND')throw new NotFoundException('Calculation job was not found.');
    throw new ConflictException({code:error.code,message:error.code==='RANGE_TOO_LARGE'?'The pending range exceeds 3,661 days. Contact the operator.':'Check calculation status before trying again.'});
   }throw error;
  }
 }
}
function empty(body:unknown){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new BadRequestException('An empty calculation action is required.')}
