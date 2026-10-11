export interface ProviderMetricStatus {
  provider:'strava'|'garmin'; linked:boolean; compactRetained:boolean; rawRetained:boolean|null;
  state:'not_linked'|'linked_unprocessed'|'linked_no_rich_data'|'raw_retained_unprocessed'|'processed'|'partial'|'failed'|'stale';
  lastProjectedAt:string|null;failureCategory:string|null;valueCount:number;missingCount:number;rejectedCount:number;
  compactOnly:boolean;missingCategories:string[];
}
export interface ActivityMetricComparison {
  key:string;label:string;unit:string;
  selected:{value:number;source:string;reason:'canonical_authority'|'provider_priority'}|null;
  candidates:{provider:'strava'|'garmin';value:number;sourceKind:string;sourceField:string;sourceUnit:string;origin:string;selectedWithinProvider:boolean;projectionId:string;projectedAt:string}[];
}
export function providerMetricState(status:ProviderMetricStatus):string {
  return ({not_linked:'Not linked',linked_unprocessed:'Linked · normalization not run',linked_no_rich_data:'Linked · rich data missing',raw_retained_unprocessed:'Raw retained · normalization not run',processed:'Normalized',partial:status.compactOnly?'Normalized summary · rich data missing':'Partially normalized',failed:'Normalization failed',stale:'Normalization stale'})[status.state];
}
export function providerListState(status: ProviderMetricStatus): string {
  return ({ not_linked: 'No link', linked_unprocessed: 'Pending', linked_no_rich_data: 'Summary only',
    raw_retained_unprocessed: 'Pending', processed: 'Ready', partial: status.compactOnly ? 'Summary only' : 'Partial',
    failed: 'Failed', stale: 'Outdated' })[status.state];
}
export function providerListDescription(status: ProviderMetricStatus): string {
  if (!status.linked) return 'Not linked';
  const metrics = ({ not_linked: 'Not linked', linked_unprocessed: 'Metrics pending', linked_no_rich_data: 'Summary only',
    raw_retained_unprocessed: 'Metrics pending', processed: 'Metrics ready', partial: 'Some metrics missing',
    failed: 'Metric processing failed', stale: 'Metrics need updating' })[status.state];
  const details = status.rawRetained === true ? 'Detail saved' : status.rawRetained === false ? 'No saved detail' : 'Detail not checked';
  return `Linked. ${metrics}. ${details}`;
}
export function metricValue(value:number,unit:string):string {
  if (unit==='m') return value>=1000 ? `${(value/1000).toLocaleString(undefined,{maximumFractionDigits:3})} km` : `${value.toLocaleString(undefined,{maximumFractionDigits:2})} m`;
  return `${value.toLocaleString(undefined,{maximumFractionDigits:3})} ${unit}`;
}
