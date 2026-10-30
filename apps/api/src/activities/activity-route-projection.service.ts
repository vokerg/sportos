import {Injectable} from '@nestjs/common';
import {ActivityRouteProjectionService as RetainedRouteRuntime} from '@sportos/garmin-runtime';
import {DbProvider,ActivityDetailDbProvider} from '../db.provider.js';
@Injectable()
export class ActivityRouteProjectionService extends RetainedRouteRuntime{
 constructor(primary:DbProvider,detail:ActivityDetailDbProvider){super(primary,detail)}
}
