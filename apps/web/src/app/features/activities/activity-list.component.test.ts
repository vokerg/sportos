// @vitest-environment jsdom
import 'zone.js';
import 'zone.js/testing';
import '@angular/compiler';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { beforeAll, afterEach, it, expect } from 'vitest';
import { ActivityCardComponent } from './ui/activity-card.component';
import { ActivityListComponent } from './activity-list.component';
import type { Activity } from './activities-api.service';
beforeAll(()=>TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting()));
afterEach(()=>TestBed.resetTestingModule());
it.each([false,true])('labels reconstructed summaries in compact=%s history without invented time or GPS',compact=>{
 const component = compact ? ActivityListComponent : ActivityCardComponent;
 TestBed.overrideComponent(component,{set:{imports:[RouterLink],schemas:[CUSTOM_ELEMENTS_SCHEMA]}});
 TestBed.configureTestingModule({imports:[component],providers:[provideRouter([])]});
 const fixture=TestBed.createComponent(component as typeof ActivityListComponent);
 const activity={id:'historical',activity_date:'2074-05-01',start_time:null,activity_type:'run',subtype:'unknown',source:'my_sport_xlsx',distance_m:5000,duration_s:null,moving_time_s:null,avg_pace_s_per_km:null,historicalSummary:true} as Activity;
 // Vitest uses JIT without the Angular signal-input compiler transform.
 Object.defineProperty(fixture.componentInstance,compact ? 'activities' : 'activity',{value:()=>compact ? [activity] : activity});
 Object.defineProperty(fixture.componentInstance,'compact',{value:()=>compact});fixture.detectChanges();
 expect(fixture.nativeElement.textContent).toContain('Historical Excel summary');expect(fixture.nativeElement.textContent).toContain('5 km');
 expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/activity/historical');
});
