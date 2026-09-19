/** Keep kilometer inputs readable while retaining sub-meter meter precision. */
export function metersToKilometers(meters: number): number {
  return Math.round((meters / 1000) * 1_000_000) / 1_000_000;
}

export function kilometersToMeters(kilometers: number): number {
  return Math.round(kilometers * 1_000_000) / 1000;
}
