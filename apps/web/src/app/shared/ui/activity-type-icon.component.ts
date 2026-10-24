import { Component } from '@angular/core';

export type ActivityIconType =
  | 'steps' | 'walk' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus';

/** Small, accessible sport marks used where an activity title alone is too slow to scan. */
@Component({
  selector: 'sportos-activity-type-icon', standalone: true, inputs: ['activityType', 'label', 'decorative'],
  template: `
    <svg [attr.role]="decorative ? null : 'img'" [attr.aria-hidden]="decorative ? 'true' : null"
      [attr.aria-label]="decorative ? null : label || name" [attr.data-activity]="activityType" viewBox="0 0 32 32" focusable="false">
      @if (!decorative) { <title>{{ label || name }}</title> }
      @switch (activityType) {
        @case ('steps') {
          <path d="M10 4c3.2.8 4.8 4 4.1 7.1-.6 2.8-3 4.4-5.2 3.1C6.5 12.8 6.9 5.9 10 4Zm11.8 13.2c3.2.8 4.8 4 4.1 7.1-.6 2.8-3 4.4-5.2 3.1-2.4-1.4-2-8.3 1.1-10.2Z" />
        }
        @case ('walk') {
          <circle cx="16" cy="5" r="2.7" /><path d="m15 9-2 7 4 4 2 8m-4-8-6 5m6-9 6 2 3-5" />
        }
        @case ('run') {
          <circle cx="18" cy="5" r="2.7" /><path d="m16 9-4 7 5 4 1 8m-2-8-8 3m5-7 7 1 5-5" />
        }
        @case ('bike') {
          <circle cx="7" cy="23" r="5" /><circle cx="25" cy="23" r="5" /><path d="M7 23 13 10h5l7 13m-12-7 8 0m-8 0-3-6h-4m9 6 5-6h4" />
        }
        @case ('swim') {
          <circle cx="22" cy="7" r="2.5" /><path d="m19 11-6 5 5 2 5-3m-17 7c2.5-2 5-2 7.5 0s5 2 7.5 0 5-2 7.5 0M4 26c2.5-2 5-2 7.5 0s5 2 7.5 0 5-2 7.5 0" />
        }
        @case ('workout') {
          <path d="M5 12v8m4-11v14m4-9h6m4-5v14m4-11v8M9 16h14" />
        }
        @case ('rowing') {
          <path d="M5 22h22l-4 5H9l-4-5Zm16-15L11 24m7-16 4-4" /><path d="M8 18h15" />
        }
        @case ('sup') {
          <path d="M4 23c5-2 19-2 24 0-3 4-21 4-24 0ZM19 4l-4 16m0-16 5 5" />
        }
        @case ('hiit') {
          <path d="m18 3-9 14h7l-2 12 9-15h-7l2-11Z" />
        }
        @default {
          <path d="m16 3 3.5 7 7.5 1.1-5.5 5.4 1.3 7.5-6.8-3.5-6.8 3.5 1.3-7.5L5 11.1 12.5 10 16 3Z" />
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; color: var(--activity-icon-color, var(--sport-run)); }
    svg { width: var(--activity-icon-size, 24px); height: var(--activity-icon-size, 24px); overflow: visible; }
    path, circle { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    [data-activity="bonus"] { fill: currentColor; }
  `],
})
export class ActivityTypeIconComponent {
  activityType: ActivityIconType = 'run';
  label = '';
  decorative = true;

  get name(): string {
    return ({ steps: 'Steps', walk: 'Walk', run: 'Run', bike: 'Bike', swim: 'Swim', workout: 'Workout', rowing: 'Rowing', sup: 'SUP', hiit: 'HIIT', bonus: 'Bonus' } as Record<ActivityIconType, string>)[this.activityType] ?? 'Activity';
  }
}
