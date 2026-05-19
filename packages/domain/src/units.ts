export const metersToKm = (meters: number): number => meters / 1000;
export const kmToMeters = (km: number): number => km * 1000;
export const mpsToKmh = (mps: number): number => mps * 3.6;
export const secondsToPacePerKm = (durationS: number, distanceM: number): number => {
  if (distanceM <= 0) throw new Error('distanceM must be positive');
  return durationS / (distanceM / 1000);
};
export const secondsToHhMmSs = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`;
};
