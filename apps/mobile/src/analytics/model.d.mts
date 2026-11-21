export const METRICS:string[];export const WINDOWS:number[];
export interface Month {key:string;from:string;to:string;calendarDays:number;recordedDays:number;partial:boolean;values:Record<string,{total:number|null;average:number|null}>;distances:Record<string,number|null>;contributions:Record<string,number|null>}
export interface RollingPoint {date:string;dailyValue:number|null;total:number|null;average:number|null;activeDays:number|null;recordedDays:number;windowDays:number;complete:boolean}
export interface Rolling {metric:string;unit:string;points:RollingPoint[];contributions:{date:string;total:number;values:Record<string,number|null>}[]}
export function analyticsPath(query:{mode:string;from:string;to:string;metric?:string;window?:number}):string;
export function projectMonthly(raw:unknown):Month[];
export function projectRolling(raw:unknown,metric:string,window:number):Rolling;
export function chartSegments(values:(number|null)[],width?:number,height?:number):{x:number;y:number;index:number}[][];

export interface DynamicsRecord {metric:string;windowDays:number;period:string;date:string;value:number;recordedDays:number}
export function historyPath(to:string):string;
export function projectHistory(raw:unknown,metric:string,window:number):Rolling & {records:DynamicsRecord[]};
export function changeViewport(dates:string[],range:{from:string;to:string},current:{start:number;end:number}|null,action:'in'|'out'|'all'|'earlier'|'later'):{start:number;end:number};
