import type { Routes } from '@angular/router';

export const APP_ROUTES: Routes = [
  {
    path: 'overview',
    loadComponent: () => import('./overview-page.component').then((module) => module.OverviewPageComponent),
    title: 'Overview · SportOS',
  },
  {
    path: 'daily',
    loadComponent: () => import('./daily-log.component').then((module) => module.DailyLogComponent),
    title: 'Daily Log · SportOS',
  },
  {
    path: 'daily/:date',
    loadComponent: () => import('./daily-detail-page.component').then((module) => module.DailyDetailPageComponent),
    title: 'Daily score · SportOS',
  },
  {
    path: 'run-lab',
    loadComponent: () => import('./run-lab.component').then((module) => module.RunLabComponent),
    title: 'Run Lab · SportOS',
  },
  {
    path: 'analysis',
    loadComponent: () => import('./analysis-panel.component').then((module) => module.AnalysisPanelComponent),
    title: 'Analysis · SportOS',
  },
  {
    path: 'rules',
    loadComponent: () => import('./rules-studio.component').then((module) => module.RulesStudioComponent),
    title: 'Rules Studio · SportOS',
  },
  {
    path: 'providers',
    loadComponent: () => import('./provider-panel.component').then((module) => module.ProviderPanelComponent),
    title: 'Providers · SportOS',
  },
  {
    path: 'imports',
    loadComponent: () => import('./imports-page.component').then((module) => module.ImportsPageComponent),
    title: 'Imports · SportOS',
  },
  {
    path: 'export',
    loadComponent: () => import('./export-panel.component').then((module) => module.ExportPanelComponent),
    title: 'Export · SportOS',
  },
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  { path: '**', redirectTo: 'overview' },
];
