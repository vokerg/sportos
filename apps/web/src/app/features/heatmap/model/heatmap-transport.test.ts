import { describe, expect, it } from 'vitest';
import { decodeHeatmapPage, decodeHeatmapPolyline } from './heatmap-transport';
import type { HeatmapPage } from './heatmap.models';

describe('bounded compact heatmap transport', () => {
  it('decodes precision-5 latitude-first transport to longitude-first GPS', () => {
    expect(decodeHeatmapPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2,38.5],[-120.95,40.7],[-126.453,43.252],
    ]);
  });
  it('preserves disjoint geometry and refuses malformed, oversized or out-of-range encoding', () => {
    const page = {items:[{geometry:{type:'MultiLineString',polylines:['??A?','???A']}}]} as unknown as HeatmapPage;
    expect(decodeHeatmapPage(page).items[0]?.geometry).toEqual({type:'MultiLineString',coordinates:[[[0,0],[0,0.00001]],[[0,0],[0.00001,0]]]});
    for (const value of [null,'???','!!!!','~~~~~~~?','??'+'A?'.repeat(5000),'??'+'~'.repeat(30000)]) {
      expect(() => decodeHeatmapPolyline(value)).toThrow();
    }
    expect(() => decodeHeatmapPage({items:[{geometry:{type:'LineString',polylines:['??A?','??A?']}}]} as unknown as HeatmapPage)).toThrow();
  });
});
