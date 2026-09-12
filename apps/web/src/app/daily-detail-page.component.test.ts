import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DailyDetailPageComponent } from './daily-detail-page.component';
import type { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const date = '2026-09-11';
const breakdown: DailyScoreBreakdown = {
  date,
  recomputedAt: '2026-09-11T12:00:00.000Z',
  scoreStatus: 'manual',
  facts: { steps: 5070, runM: 0, bikeM: 27550, swimM: 0, workoutPoints: 0, powerPoints: 2000 },
  score: { appTotal: 24978, excelTotal: null, delta: null, baseTotal: 22978, bonusTotal: 2000, ledgerTotal: 24978 },
  sourceRecord: null,
  activities: [],
  sourceRecords: [],
  ledger: [],
};

describe('DailyDetailPageComponent', () => {
  it('loads the complete day from the route and requests edit mode', () => {
    const api = { getForDate: vi.fn().mockReturnValue(of(breakdown)) };
    const component = createComponent(api, { edit: 'true' });

    component.ngOnInit();

    expect(api.getForDate).toHaveBeenCalledWith(date);
    expect(component.breakdown()).toEqual(breakdown);
    expect(component.state()).toBe('loaded');
    expect(component.manualEditRequestId()).toBe(1);
  });

  it('allows manual entry when the selected day does not exist yet', () => {
    const api = { getForDate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 404,
      error: { code: 'DAILY_SCORE_NOT_FOUND' },
    }))) };
    const component = createComponent(api, { edit: 'true' });

    component.ngOnInit();

    expect(component.state()).toBe('loaded');
    expect(component.breakdown()).toBeNull();
    expect(component.manualEditRequestId()).toBe(1);
  });

  it('saves all manual facts and removes the edit query', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const api = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      saveManualFacts: vi.fn().mockReturnValue(of(breakdown)),
    };
    const component = createComponent(api, { edit: 'true' }, router);
    component.ngOnInit();
    const input = { steps: 5070, runIndoorM: 0, runOutdoorM: 0, runUnspecifiedM: 0, bikeIndoorM: 0, bikeOutdoorM: 27550, bikeUnspecifiedM: 0, swimM: 0, workoutPoints: 0, powerPoints: 2000 };

    component.saveManualFacts(input);

    expect(api.saveManualFacts).toHaveBeenCalledWith(date, input);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {}, replaceUrl: true }));
    expect(component.savingManual()).toBe(false);
  });
});

function createComponent(
  api: { getForDate: ReturnType<typeof vi.fn>; saveManualFacts?: ReturnType<typeof vi.fn> },
  query: Record<string, string> = {},
  router: { navigate: ReturnType<typeof vi.fn> } = { navigate: vi.fn().mockResolvedValue(true) },
): DailyDetailPageComponent {
  const route = {
    paramMap: of(convertToParamMap({ date })),
    snapshot: { queryParamMap: convertToParamMap(query) },
  };
  return new DailyDetailPageComponent(
    route as unknown as ActivatedRoute,
    router as unknown as Router,
    api as unknown as ScoreBreakdownApiService,
  );
}
