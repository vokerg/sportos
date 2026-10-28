import type {FeatureCollection, LineString, Point} from 'geojson';
export interface MapRoute {source:'strava'|'garmin';resolution:string;geometry:{type:'LineString';coordinates:[number,number][]}|{type:'MultiLineString';coordinates:[number,number][][]}}
export function projectRoute(raw:unknown):({status:'available'} & MapRoute)|{status:'unavailable';reason:string};
export function projectHeatmap(raw:unknown):{items:MapRoute[];coverage:Record<string,number>;hasMore:boolean;nextCursor:string|null};
export function mapData(routes:MapRoute[]):{bounds:[[number,number],[number,number]];lines:FeatureCollection<LineString>;density:FeatureCollection<Point>;start:[number,number];finish:[number,number];points:number;densityTruncated:boolean};
export function geometry(raw:unknown):MapRoute['geometry'];
