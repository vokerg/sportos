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
    path: 'monthly-stats',
    loadComponent: () => import('./monthly-stats-page.component').then((module) => module.MonthlyStatsPageComponent),
    title: 'Monthly Stats · SportOS',
  },
  {
    path: 'dynamics',
    loadComponent: () => import('./rolling-dynamics-page.component').then((module) => module.RollingDynamicsPageComponent),
    title: 'Dynamics · SportOS',
  },
  {
    path: 'run-lab',
    loadComponent: () => import('./run-lab.component').then((module) => module.RunLabComponent),
    title: 'Run Lab · SportOS',
  },
  {
    path: 'activities',
    loadComponent: () => import('./features/activities/activities-page.component').then((module) => module.ActivitiesPageComponent),
    title: 'Activities · SportOS',
  },
  {
    path: 'heatmap',
    loadComponent: () => import('./features/heatmap/pages/heatmap-page.component').then((module) => module.HeatmapPageComponent),
    title: 'My heatmap · SportOS',
  },
  {
    path: 'activity/:id/map',
    loadComponent: () => import('./features/activities/pages/activity-map-page.component').then((module) => module.ActivityMapPageComponent),
    title: 'Activity map · SportOS',
    data: { fullPage: true },
  },
  {
    path: 'activity/:id',
    loadComponent: () => import('./features/activities/activity-detail-page.component').then((module) => module.ActivityDetailPageComponent),
    title: 'Activity · SportOS',
  },
  {
    path: 'analysis',
    loadComponent: () => import('./analysis-panel.component').then((module) => module.AnalysisPanelComponent),
    title: 'Analysis · SportOS',
  },
  {
    path: 'rules',
    loadComponent: () => import('./features/rules/pages/rules-page.component').then((module) => module.RulesPageComponent),
    title: 'Scoring rules · SportOS',
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
