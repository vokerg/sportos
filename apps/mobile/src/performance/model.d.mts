export const TARGETS:number[];
export interface LeaderboardRow {id:string;date:string;durationS:number;rank:number;source:string;pausePolicy:string;activityId:string|null;eventId:string|null;alternativeCount:number;alternatives:{source:string;durationS:number;eventId:string|null}[]}
export interface Leaderboard {targetDistanceM:number;total:number;offset:number;limit:number;coverage:Record<string,number>;rows:LeaderboardRow[]}
export function leaderboardPath(query?:{distanceM?:number;from?:string;to?:string;offset?:number}):string;
export function projectLeaderboard(raw:unknown):Leaderboard;
export interface EventDetail {id:string;date:string;distanceM:number;durationS:number;paceSPerKm:number;source:string;activityId:string|null;isTreadmill:boolean;provenance:string;reconciliation:string}
export function projectEvent(raw:unknown):EventDetail;
