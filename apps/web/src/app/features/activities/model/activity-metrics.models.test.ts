import { describe,expect,it } from 'vitest';
import { providerListState,providerListDescription,metricValue,providerMetricState,type ProviderMetricStatus } from './activity-metrics.models';
const status:ProviderMetricStatus={provider:'garmin',linked:true,compactRetained:true,rawRetained:true,state:'processed',lastProjectedAt:null,failureCategory:null,valueCount:0,missingCount:10,rejectedCount:0,compactOnly:false,missingCategories:[]};
describe('activity metric presentation',()=>{
  it('keeps linkage/raw/processing conditions distinct and allows zero optional values',()=>{
    expect(providerMetricState(status)).toBe('Normalized');
    expect(providerMetricState({...status,state:'raw_retained_unprocessed'})).toContain('normalization not run');
    expect(providerMetricState({...status,state:'not_linked',linked:false})).toBe('Not linked');
    expect(providerMetricState({...status,state:'partial',compactOnly:true,rawRetained:false})).toContain('rich data missing');
    expect(providerMetricState({...status,state:'failed'})).toBe('Normalization failed');
    expect(providerMetricState({...status,state:'stale'})).toBe('Normalization stale');
  });
  it('displays provider disagreement without rounding away twenty metres',()=>{
    expect(metricValue(10020,'m')).toContain('10.02');expect(metricValue(10000,'m')).toContain('10');expect(metricValue(0,'kcal')).toBe('0 kcal');
  });
});

it.each([
  ['not_linked', 'No link'], ['linked_unprocessed', 'Pending'], ['linked_no_rich_data', 'Summary only'],
  ['raw_retained_unprocessed', 'Pending'], ['processed', 'Ready'], ['partial', 'Partial'], ['failed', 'Failed'], ['stale', 'Outdated'],
])('uses a short %s label without conflating source availability', (state, label) => {
  expect(providerListState({ ...status, state } as ProviderMetricStatus)).toBe(label);
});
it('keeps unchecked and missing detail distinct on hover', () => {
  expect(providerListDescription({ ...status, rawRetained: null })).toContain('Detail not checked');
  expect(providerListDescription({ ...status, rawRetained: false })).toContain('No saved detail');
  expect(providerListDescription(status)).toContain('Detail saved');
  expect(providerListState({ ...status, state: 'partial', compactOnly: true })).toBe('Summary only');
});
