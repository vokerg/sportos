import type { DailySummary, ContributionCategory, ScoreAuthority } from './contracts';
export declare function dailySummaryPath(options?: { from?: string; to?: string; limit?: number }): string;
export declare function scoreBreakdownPath(date: string): string;
export declare function formatPoints(value: number | null | undefined, signed?: boolean): string;
export declare function scoreAuthority(value: ScoreAuthority | string): string;
export declare function contributionRows(values?: Partial<Record<ContributionCategory, number>> | null):
  Array<{ key: ContributionCategory; label: string; points: number }>;
export declare function mergeDays(existing: DailySummary[], older: DailySummary[]): DailySummary[];
export declare function todayCoverage(date: string, today: string): string;
export declare function sourceNames(sources?: { strava: boolean; garmin: boolean } | null): string;
export declare function safeActivityType(value: string): string;
