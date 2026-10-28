// Display-only, bounded private geometry. No disk persistence or provider requests.
const fail = () => { throw new Error('Invalid retained map response.'); };
const sources = ['strava', 'garmin'];
const resolutions = ['summary', 'streams', 'detail', 'fit'];
export function geometry(value) {
  if (!value || !['LineString', 'MultiLineString'].includes(value.type)) return fail();
  const parts = value.type === 'LineString' ? [value.coordinates] : value.coordinates;
  if (!Array.isArray(parts) || !parts.length || parts.length > 50) return fail();
  let count = 0;
  const clean = parts.map(part => {
    if (!Array.isArray(part) || part.length < 2) return fail();
    return part.map(p => {
      if (++count > 5000 || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)
        || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return fail();
      return [p[0], p[1]];
    });
  });
  return value.type === 'LineString' ? {type:value.type,coordinates:clean[0]} : {type:value.type,coordinates:clean};
}
export function projectRoute(raw) {
  if (raw?.status === 'unavailable' && ['no_gps','summary_polyline_missing','invalid_geometry','indoor_pool_swim'].includes(raw.reason))
    return {status:'unavailable',reason:raw.reason};
  if (raw?.status !== 'available' || !sources.includes(raw.source) || !resolutions.includes(raw.resolution)) return fail();
  return {status:'available',source:raw.source,resolution:raw.resolution,geometry:geometry(raw.geometry)};
}
export function projectHeatmap(raw) {
  if (!raw || !Array.isArray(raw.items) || raw.items.length > 25 || typeof raw.hasMore !== 'boolean'
    || (raw.hasMore && (typeof raw.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(raw.nextCursor)))) return fail();
  const items = raw.items.map(item => {
    if (!sources.includes(item.source) || !resolutions.includes(item.resolution)) return fail();
    return {source:item.source,resolution:item.resolution,geometry:geometry(item.geometry)};
  });
  const coverage = {};
  for (const key of ['eligibleScanned','usable','missingGps','invalidGeometry','budgetExceeded']) {
    const n=raw.coverage?.[key];
    if (!Number.isSafeInteger(n) || n<0) return fail();
    coverage[key]=n;
  }
  return {items,coverage,hasMore:raw.hasMore,nextCursor:raw.hasMore?raw.nextCursor:null};
}
export function mapData(routes) {
  if(routes.length>50)throw new Error('Map route limit reached. Narrow the date range.');
  let densityTruncated=false;
  let points=0;
  const lines=[]; const cells=new Map();
  let west=180,south=90,east=-180,north=-90;
  for (const route of routes.slice(0,50)) {
    const seen = new Set();
    const parts=route.geometry.type==='LineString'?[route.geometry.coordinates]:route.geometry.coordinates;
    for(const part of parts) {
      // Preserve recording gaps; never join separate parts.
      const line=[];
      for(const p of part) {
        if(++points>75000) throw new Error('Map point limit reached. Narrow the date range.');
        west=Math.min(west,p[0]);east=Math.max(east,p[0]);south=Math.min(south,p[1]);north=Math.max(north,p[1]);
        line.push(p);
        // Per-route occupied cells avoid weighting long recordings by sample frequency.
        const x=Math.floor(p[0]*1000), y=Math.floor(p[1]*1000), key=x+','+y;
        if(!seen.has(key)) {
          seen.add(key);
          const existing=cells.get(key);
          if(existing) existing.properties.weight++;
          else if(cells.size<15000) cells.set(key,{type:'Feature',properties:{weight:1},geometry:{type:'Point',coordinates:[(x+.5)/1000,(y+.5)/1000]}});
          else densityTruncated=true;
        }
      }
      lines.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:line}});
    }
  }
  return {bounds:[[west,south],[east,north]],lines:{type:'FeatureCollection',features:lines},
    density:{type:'FeatureCollection',features:[...cells.values()]},
    start:lines[0]?.geometry.coordinates[0],finish:lines.at(-1)?.geometry.coordinates.at(-1),points,densityTruncated};
}
