/** Type declarations for the Node-testable mobile presentation helpers. */
export function formatDistance(metres: number): string;
export function formatDuration(seconds: number): string;
export function formatPace(secondsPerKm: number): string;
export function isCalendarDate(value: unknown): value is string;
export function shiftCalendarDate(date: string, days: number): string;
export function localToday(now?: Date): string;
export function localActivityTime(startTime: string | null): string | null;
