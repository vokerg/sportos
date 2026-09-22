import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ImportsStore } from './features/imports/state/imports.store';
import { ImportPanelComponent } from './import-panel.component';

@Component({
  selector: 'sportos-imports-page',
  standalone: true,
  imports: [ImportPanelComponent],
  providers: [ImportsStore],
  template: `<sportos-import-panel (reconcileDate)="openDay($event)" />`,
})
export class ImportsPageComponent implements OnInit {
  constructor(
    private readonly router: Router,
    private readonly store: ImportsStore,
  ) {}

  ngOnInit(): void {
    this.store.initialize();
  }

  openDay(date: string): void {
    void this.router.navigate(['/daily', date]);
  }
}
