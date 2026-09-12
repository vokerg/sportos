import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ImportPanelComponent } from './import-panel.component';

@Component({
  selector: 'sportos-imports-page',
  standalone: true,
  imports: [ImportPanelComponent],
  template: `<sportos-import-panel (reconcileDate)="openDay($event)" />`,
})
export class ImportsPageComponent {
  constructor(private readonly router: Router) {}

  openDay(date: string): void {
    void this.router.navigate(['/daily', date]);
  }
}
