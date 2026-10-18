// @vitest-environment jsdom
import 'zone.js';
import 'zone.js/testing';
import {BrowserDynamicTestingModule,platformBrowserDynamicTesting} from '@angular/platform-browser-dynamic/testing';
import '@angular/compiler';
import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {of,Subject,type Observable} from 'rxjs';
import {beforeAll,afterEach,describe,it,expect} from 'vitest';
import {DistanceLeaderboardComponent} from './distance-leaderboard.component';
import {PerformanceApiService} from '../data-access/performance-api.service';
import type {DistanceLeaderboard} from '../model/performance.models';
beforeAll(()=>TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting()));
const coverage={eligibleRuns:3,measuredCurrent:1,legacyLinked:1,legacyUnmatched:0,legacyAmbiguous:0,estimatedOnly:1,missingRichDetail:1,unprocessed:1,staleOrFailed:0,unavailable:0};
describe('distance leaderboard view',()=>{
 afterEach(()=>TestBed.resetTestingModule());
 function render(response:Observable<DistanceLeaderboard>){TestBed.configureTestingModule({imports:[DistanceLeaderboardComponent],providers:[provideRouter([]),{provide:PerformanceApiService,useValue:{leaderboard:()=>response}}]});const fixture=TestBed.createComponent(DistanceLeaderboardComponent);fixture.detectChanges();return fixture;}
 it('shows original timing and measured alternative once, with provenance links',()=>{const fixture=render(of({targets:[5000,10000,15000,20000,21097.5,25000,42195],targetDistanceM:5000,total:1,limit:100,offset:0,coverage,rows:[{id:'excel',activityId:'run',eventId:'original',date:'2026-05-01',durationS:1200,rank:1,source:'excel',reason:null,alternativeCount:1,pausePolicy:'historical_excel',alternatives:[{source:'strava',durationS:1250,eventId:null,reason:null}]}]}));const el=fixture.nativeElement as HTMLElement;expect(el.querySelectorAll('tbody tr')).toHaveLength(1);expect(el.textContent).toContain('20:00');expect(el.textContent).toContain('Calculated Strava');expect(el.textContent).toContain('historical time');expect(el.querySelector('a')?.getAttribute('href')).toBe('/activity/run');expect(el.textContent).toContain('does not mean');expect(el.querySelectorAll('select')[0].querySelectorAll('option')).toHaveLength(7);expect(el.textContent).toContain('1–1 of 1 records');});
 it('renders global ranks and last-page navigation for results beyond 200',()=>{
  const row={id:'page-row',activityId:'run',eventId:'original',date:'2074-01-01',durationS:1800,rank:201,source:'excel' as const,reason:null,alternativeCount:0,pausePolicy:'historical_excel',alternatives:[]};
  const fixture=render(of({targets:[5000],targetDistanceM:5000,total:225,limit:100,offset:200,coverage,rows:[row]}));
  const el=fixture.nativeElement as HTMLElement;expect(el.textContent).toContain('201–201 of 225 records');expect(el.querySelector('tbody td')?.textContent).toBe('201');
  const buttons=[...el.querySelectorAll('nav button')] as HTMLButtonElement[];expect(buttons.map(b=>b.disabled)).toEqual([false,false,true,true]);
 });
 it('shows honest empty and loading states',()=>{const pending=new Subject<DistanceLeaderboard>();const fixture=render(pending);expect(fixture.nativeElement.textContent).toContain('Loading');pending.next({targets:[5000],targetDistanceM:5000,total:0,limit:100,offset:0,rows:[],coverage});fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('No qualified records');});
});
