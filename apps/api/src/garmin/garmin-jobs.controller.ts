import {Body,Controller,Get,Param,Post,HttpCode,BadRequestException} from '@nestjs/common';
import {CurrentAccount} from '../auth/current-account.decorator.js';
import type {AuthenticatedAccount} from '../auth/auth.models.js';
import {LEGACY_ACCOUNT_ID} from '@sportos/db';
import {assertUuid} from '../query-validation.js';
import {GarminJobsService} from './garmin-jobs.service.js';
@Controller('garmin')
export class GarminJobsController{
 constructor(private jobs:GarminJobsService){}
 @Get('connection') capability(@CurrentAccount() account?:AuthenticatedAccount){return this.jobs.capability(account?.id??LEGACY_ACCOUNT_ID)}
 @Get('jobs/:id') get(@Param('id') id:string,@CurrentAccount() account?:AuthenticatedAccount){assertUuid(id,'INVALID_JOB_ID');return this.jobs.get(account?.id??LEGACY_ACCOUNT_ID,id)}
 @Post('jobs/:id/cancel') @HttpCode(202)
 cancel(@Param('id') id:string,@Body() body:unknown,@CurrentAccount() account?:AuthenticatedAccount){this.validate(id,body);return this.jobs.cancel(account?.id??LEGACY_ACCOUNT_ID,id)}
 @Post('jobs/:id/retry') @HttpCode(202)
 retry(@Param('id') id:string,@Body() body:unknown,@CurrentAccount() account?:AuthenticatedAccount){this.validate(id,body);return this.jobs.retry(account?.id??LEGACY_ACCOUNT_ID,id)}
 private validate(id:string,body:unknown){assertUuid(id,'INVALID_JOB_ID');if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new BadRequestException('An empty Garmin job action is required.')}
}
