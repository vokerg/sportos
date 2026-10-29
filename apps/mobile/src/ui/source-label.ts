/** Friendly display names only; internal adapter/table names never become UI copy. */
export function sourceLabel(source:string):string{
 return ({strava:'Strava',strava_api:'Strava',garmin:'Garmin',garmin_connect:'Garmin',garmin_fit:'Garmin',manual:'Manual',my_sport_xlsx:'Workbook',run_db_xlsx:'Workbook',google_sheets:'Spreadsheet',fit:'FIT file'} as Record<string,string>)[source]??'Imported';
}
