import type { DailyScoreBreakdown, ManualDailyFactsInput } from '../../../score-breakdown.models';

export interface DailyQuickEntryGridRow extends ManualDailyFactsInput {
  date: string;
  totalPoints: number;
  scoreStatus: 'imported' | 'calculated' | 'manual';
  saving?: boolean;
  refreshing?: boolean;
  error?: string | null;
}

export interface DailyQuickEntryChange {
  date: string;
  input: ManualDailyFactsInput;
  previous: DailyQuickEntryGridRow;
}

export function blankQuickEntryRow(date: string): DailyQuickEntryGridRow {
  return {
    date,
    scoreStatus: 'manual',
    totalPoints: 0,
    steps: 0,
    runIndoorM: 0,
    runOutdoorM: 0,
    runUnspecifiedM: 0,
    bikeIndoorM: 0,
    bikeOutdoorM: 0,
    bikeUnspecifiedM: 0,
    swimM: 0,
    workoutPoints: 0,
    bonusPoints: 0,
  };
}

export function quickEntryRowFromBreakdown(result: DailyScoreBreakdown): DailyQuickEntryGridRow {
  const runIndoorM = result.facts.runIndoorM ?? 0;
  const runOutdoorM = result.facts.runOutdoorM ?? 0;
  const bikeIndoorM = result.facts.bikeIndoorM ?? 0;
  const bikeOutdoorM = result.facts.bikeOutdoorM ?? 0;

  return {
    date: result.date,
    scoreStatus: result.scoreStatus,
    totalPoints: result.score.appTotal,
    steps: result.facts.steps,
    runIndoorM,
    runOutdoorM,
    runUnspecifiedM: result.facts.runUnspecifiedM ?? Math.max(result.facts.runM - runIndoorM - runOutdoorM, 0),
    bikeIndoorM,
    bikeOutdoorM,
    bikeUnspecifiedM: result.facts.bikeUnspecifiedM ?? Math.max(result.facts.bikeM - bikeIndoorM - bikeOutdoorM, 0),
    swimM: result.facts.swimM,
    workoutPoints: result.facts.workoutPoints,
    bonusPoints: result.score.bonusPoints,
    saving: false,
    refreshing: false,
    error: null,
  };
}
