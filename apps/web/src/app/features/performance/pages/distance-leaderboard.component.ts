import { Component, OnInit, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DistanceLeaderboardStore } from '../state/distance-leaderboard.store';
@Component({
  selector:'sportos-distance-leaderboard',standalone:true,imports:[RouterLink],providers:[DistanceLeaderboardStore],
  template:`
    <section class="card" aria-labelledby="distance-leaderboard-title">
      <h2 id="distance-leaderboard-title">Distance leaderboard</h2>
      <p>Original Excel achievements and current calculated distance windows. Excel times keep their historical timing semantics;
        calculated Strava moving time and Garmin timer-active time exclude pauses. These are analytical records, not certified race PRs.</p>
      <form class="filter-bar" (submit)="refresh(); $event.preventDefault()">
        <label>Distance <select [value]="store.distanceM()" (change)="store.distanceM.set(+$any($event.target).value)">
          @for (target of targets(); track target) {<option [value]="target">{{label(target)}}</option>}
        </select></label>
        <label>From <input type="date" [value]="store.from()" (input)="store.from.set($any($event.target).value)" /></label>
        <label>To <input type="date" [value]="store.to()" (input)="store.to.set($any($event.target).value)" /></label>
        <label>Per page <select [value]="store.pageSize()" (change)="pageSize(+$any($event.target).value)">
          <option [value]="50">50</option><option [value]="100">100</option><option [value]="200">200</option>
        </select></label>
        <button type="submit" [disabled]="store.loading()">Refresh leaderboard</button>
      </form>
      @if(store.loading()) {<p role="status">Loading qualified records…</p>}
      @if(store.error()) {<p role="alert">{{store.error()}}</p><button (click)="store.retry()">Retry</button>}
      @if(store.result(); as result) {
        <details class="coverage"><summary>Processing coverage · {{result.coverage.measuredCurrent}} measured current / {{result.coverage.eligibleRuns}} eligible linked runs</summary>
          <p>Excel: {{result.coverage.legacyLinked}} linked, {{result.coverage.legacyUnmatched}} unlinked ({{result.coverage.legacyAmbiguous}} ambiguous).
            Estimated only: {{result.coverage.estimatedOnly}}; known missing streams: {{result.coverage.missingRichDetail}};
            unprocessed: {{result.coverage.unprocessed}}; stale/failed: {{result.coverage.staleOrFailed}}; unavailable: {{result.coverage.unavailable}}.</p>
          <p>Coverage categories may overlap. Incomplete processing does not mean there are no faster runs.
            Missing detail is fetched only through an explicit activity action or local operator workflow.</p>
        </details>
        @if(!result.rows.length) {<p role="status">No qualified records for this distance and range. Estimates and stale results do not rank.</p>}
        @else {<div class="table-scroll"><table><thead><tr><th>Rank</th><th>Date</th><th>Time</th><th>Evidence</th><th>Activity / original</th></tr></thead><tbody>
          @for(row of result.rows; track row.id) {<tr>
            <td>{{row.rank}}</td><td>{{row.date}}</td><td>{{duration(row.durationS)}}</td>
            <td><span class="source-badge">{{source(row.source)}}</span> · {{row.pausePolicy === 'historical_excel' ? 'historical time' : row.pausePolicy === 'moving_flags' ? 'moving time' : 'timer-active time'}}
              @if(row.reason) {<small>{{reason(row.reason)}}</small>}
              @if(row.alternatives.length) {<details><summary>Alternative evidence ({{row.alternativeCount}})</summary>
                @if(row.alternativeCount > row.alternatives.length){<p>Showing the first {{row.alternatives.length}} of {{row.alternativeCount}} alternatives.</p>}
                @for(other of row.alternatives; track $index) {<p>{{source(other.source)}} · {{duration(other.durationS)}} @if(other.reason){ · {{reason(other.reason)}}}
                  @if(other.eventId){<button (click)="inspect.emit(other.eventId)">Inspect original</button>}</p>}
              </details>}
            </td><td>@if(row.activityId){<a [routerLink]="['/activity',row.activityId]">Open run</a>}
              @if(row.eventId){<button (click)="inspect.emit(row.eventId)">Inspect Excel</button>}</td>
          </tr>}
        </tbody></table></div>}
        <nav class="pagination" aria-label="Leaderboard pages">
          <span role="status">{{result.rows.length ? result.offset + 1 : 0}}–{{result.offset + result.rows.length}} of {{result.total}} records</span>
          <button type="button" (click)="page(0)" [disabled]="store.loading() || result.offset === 0">First</button>
          <button type="button" (click)="page(result.offset - result.limit)" [disabled]="store.loading() || result.offset === 0">Previous</button>
          <button type="button" (click)="page(result.offset + result.limit)" [disabled]="store.loading() || result.offset + result.limit >= result.total">Next</button>
          <button type="button" (click)="page(lastOffset(result.total, result.limit))" [disabled]="store.loading() || result.offset + result.limit >= result.total">Last</button>
        </nav>
      }
    </section>`,
  styles:[`:host{display:block;margin-bottom:16px}.source-badge{display:inline-block;font-size:12px;font-weight:600;padding:3px 7px;background:var(--accent-surface);color:var(--link);border-radius:6px}p{color:var(--text-muted);font-size:13px}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid var(--border)}.table-scroll{overflow-x:auto}small{display:block}.coverage{margin:14px 0}.pagination{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}.pagination span{margin-right:auto}td button,td a{margin-right:8px}`],
})
export class DistanceLeaderboardComponent implements OnInit {
  readonly store=inject(DistanceLeaderboardStore);
  readonly inspect=output<string>();
  readonly viewChange=output<void>();
  refresh(){this.viewChange.emit();this.store.load();}
  page(offset:number){this.viewChange.emit();this.store.goTo(offset);}
  pageSize(size:number){this.viewChange.emit();this.store.setPageSize(size);}
  lastOffset(total:number,limit:number){return Math.max(0,Math.floor((total-1)/limit)*limit);}
  readonly targets=this.store.targets;
  ngOnInit(){this.store.load();}
  label(target:number){return target===21097.5?'Half marathon':target===42195?'Marathon':`${target/1000} km`;}
  source(source:string){return source==='excel'?'Excel':source==='strava'?'Calculated Strava':'Calculated Garmin';}
  reason(reason:string){return reason.replaceAll('_',' ');}
  duration(seconds:number){const s=Math.round(seconds);return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
}
