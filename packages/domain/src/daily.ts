import type { ActivityFact, DailyMetricFacts } from './types.js';

export function aggregateActivitiesToDailyFacts(metricDate: string, activities: ActivityFact[], excelAllPoints?: number): DailyMetricFacts {
  const onDate = activities.filter((a) => a.activityDate === metricDate);
  return {
    metricDate,
    steps: sum(onDate.filter((a) => a.activityType === 'steps').map((a) => a.steps ?? 0)),
    runM: sum(onDate.filter((a) => a.activityType === 'run').map((a) => a.distanceM ?? 0)),
    bikeM: sum(onDate.filter((a) => a.activityType === 'bike').map((a) => a.distanceM ?? 0)),
    swimM: sum(onDate.filter((a) => a.activityType === 'swim').map((a) => a.distanceM ?? 0)),
    workoutPoints: sum(onDate.filter((a) => a.activityType === 'workout').map((a) => a.effortPoints ?? 0)),
    powerPoints: sum(onDate.filter((a) => a.activityType === 'power_bonus').map((a) => a.effortPoints ?? 0)),
    excelAllPoints,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
