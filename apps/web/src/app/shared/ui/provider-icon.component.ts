import { Component } from '@angular/core';

/** Shared provider marks used by day evidence and activity coverage. */
@Component({
  selector: 'sportos-provider-icon', standalone: true, inputs: ['provider', 'label', 'decorative'],
  template: `
    <svg [attr.role]="decorative ? null : 'img'" [attr.aria-hidden]="decorative ? 'true' : null"
      [attr.aria-label]="decorative ? null : label || name" viewBox="0 0 24 24">
      @if (!decorative) { <title>{{ label || name }}</title> }
      @if (provider === 'strava') {
        <path fill="#fc4c02" d="M10 2 2 16h5l3-5 3 5h5L10 2zm8 11-3 5h-4l7 6 6-11h-6z" />
      } @else {
        <path fill="#007cc3" d="m12 1 7 9H5z" /><text x="12" y="23" text-anchor="middle" font-size="15" font-weight="700" fill="var(--text-secondary)">G</text>
      }
    </svg>
  `,
  styles: [`:host{display:inline-flex;align-items:center}svg{width:var(--provider-icon-size,18px);height:var(--provider-icon-height,20px)}`],
})
export class ProviderIconComponent {
  provider: 'strava' | 'garmin' = 'strava';
  label = '';
  decorative = false;
  get name(): string { return this.provider === 'strava' ? 'Strava' : 'Garmin'; }
}
