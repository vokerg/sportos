import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { RulesApiService } from '../data-access/rules-api.service';
import type { RuleVersion } from '../model/rules.models';
import { ruleStatus, rulesGuideGroups } from '../model/rules-guide.models';
import { localCalendarDate } from '../../../shared/util/analytics-query-state';

@Component({
  selector: 'sportos-rules-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="page-heading">
      <div><span class="kicker">Scoring guide</span><h1>How your score works</h1>
        <p>Everyday activity builds base points. Qualifying efforts add bonuses.</p></div>
      <div class="actions"><span class="read-only">Read only</span>
        <button type="button" class="secondary" [disabled]="state() === 'loading'" (click)="refresh()">Refresh rules</button></div>
    </header>

    <section class="score-equation" aria-label="Daily score calculation">
      <div><span>01 · Foundation</span><strong>Base points</strong><p>Steps, distance and workout points</p></div>
      <b aria-hidden="true">+</b>
      <div><span>02 · Extra effort</span><strong>Achievement bonuses</strong><p>Pace and distance milestones</p></div>
      <b aria-hidden="true">=</b>
      <div class="equation-total"><span>Your day</span><strong>Daily score</strong><a routerLink="/daily">See your daily scores →</a></div>
    </section>

    @if (state() === 'loading') {
      <p class="state-message" role="status">Loading your scoring rules…</p>
    } @else if (state() === 'error') {
      <div class="state-message error" role="alert">Could not load scoring rules. <button type="button" (click)="refresh()">Try again</button></div>
    } @else if (state() === 'loaded') {
      <div class="section-heading"><h2>Current rules</h2><span>For {{ date() }}</span></div>
      @if (!groups().length) { <p class="state-message">No scoring rules are currently in effect.</p> }
      <div class="rules-grid">
        @for (group of groups(); track group.type) {
          <section class="card activity-card" [attr.data-sport]="group.type" [attr.aria-label]="group.title + ' scoring rules'">
            <header class="activity-heading"><span class="activity-mark" aria-hidden="true">{{ group.title.slice(0, 1) }}</span><h2>{{ group.title }}</h2></header>
            @for (rule of group.base; track rule.id) {
              <div class="base-rule"><span class="eyebrow">{{ rule.activityType === 'bonus' ? 'Bonus override' : 'Base points' }}</span>
                <h3>{{ rule.guide.award }}</h3><ul>@for (note of rule.guide.notes; track note) { <li>{{ note }}</li> }</ul>
              </div>
            }
            @for (bonus of group.bonuses; track bonus.id) {
              <div class="bonus-rule"><h3>Achievement {{ bonus.tiers.length > 1 ? 'ladder' : 'bonus' }}</h3>
                <div class="table-wrap"><table><caption class="visually-hidden">{{ group.title }} bonus thresholds</caption>
                  <thead><tr><th scope="col">To qualify</th><th scope="col">Bonus points</th></tr></thead>
                  <tbody>@for (rule of bonus.tiers; track rule.id) {
                    <tr><td>{{ rule.guide.label }}</td><td class="award">{{ rule.guide.award }}</td></tr>
                  }</tbody>
                </table></div>
                <ul class="conditions">@for (note of bonus.notes; track note) { <li>{{ note }}</li> }</ul>
                @if (bonus.example) { <p class="example"><strong>Example</strong> {{ bonus.example }}</p> }
              </div>
            }
          </section>
        }
      </div>
      <aside class="policy-note"><h2>A few things to know</h2>
        <p>Each activity qualifies for a bonus on its own. Faster tiers replace lower tiers within the same ladder.</p>
        <p>Walking is kept in your activity history without activity points. Its steps can still count toward your daily steps.</p>
        <p>Imported spreadsheet totals stay authoritative until you explicitly recalculate or edit that day. Use the daily score breakdown to see which rule versions produced a saved score.</p>
      </aside>
      @if (rules().length) {
        <details class="versions card"><summary>Rule versions & history <span>{{ rules().length }} versions</span></summary>
          <p>Current rules are shown above. Earlier and scheduled versions remain here for reference; a saved score keeps its original rule references.</p>
          <div class="table-wrap"><table><thead><tr><th scope="col">Rule</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Effective dates</th></tr></thead>
            <tbody>@for (rule of rules(); track rule.id) {
              <tr><td><strong>{{ rule.name }}</strong><small>{{ rule.guide.label }} · {{ rule.guide.award }}</small><code>{{ rule.code }}</code></td>
                <td>v{{ rule.version }}</td><td><span class="version-status" [class.current]="status(rule, date()) === 'Current'">{{ status(rule, date()) }}</span></td>
                <td class="dates">{{ rule.validFrom }} → {{ rule.validTo || 'No end date' }}</td></tr>
            }</tbody>
          </table></div>
        </details>
      }
    }
  `,
  styles: [`
    :host{display:block;max-width:1440px;margin:0 auto;color:var(--text,#172033)}
    .page-heading,.actions,.section-heading,.activity-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
    .page-heading{margin:4px 0 24px;align-items:flex-start}h1{font-size:clamp(28px,3vw,40px);letter-spacing:-.035em;margin:6px 0 8px}
    p{color:var(--text-muted,#667085);line-height:1.6;margin:0}h2,h3{margin:0}.kicker,.eyebrow{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--link,#244fc5)}
    .read-only{border:1px solid var(--border,#d0d5dd);padding:6px 10px;border-radius:20px;font-size:12px;color:var(--text-secondary,#475467)}
    .score-equation{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:20px;padding:24px;border-radius:18px;background:var(--accent-surface,#eef3ff);margin-bottom:30px}
    .score-equation span{font-size:11px;color:var(--text-muted,#667085);text-transform:uppercase;letter-spacing:.06em;font-weight:700}.score-equation strong{display:block;font-size:20px;margin:6px 0}.score-equation p,.score-equation a{font-size:13px}.score-equation a{color:var(--link,#244fc5)}.score-equation>b{font-size:24px;color:var(--text-muted,#667085)}
    .section-heading{margin-bottom:14px}.section-heading h2{font-size:18px}.section-heading span{font-size:12px;color:var(--text-muted,#667085)}
    .rules-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.activity-card{--activity-accent:var(--link,#244fc5);border:1px solid var(--border,#d0d5dd);box-shadow:none;padding:24px}
    .activity-card[data-sport=swim]{--activity-accent:var(--sport-swim,#096e9a)}.activity-card[data-sport=bike]{--activity-accent:var(--sport-bike,#087969)}
    .activity-heading{justify-content:flex-start;margin-bottom:22px}.activity-heading h2{font-size:22px}.activity-mark{display:grid;place-items:center;width:36px;height:36px;background:var(--accent-surface,#eef3ff);color:var(--activity-accent);border-radius:11px;font-weight:800}
    .base-rule h3{font-size:19px;margin:6px 0 12px;color:var(--activity-accent)}ul{margin:12px 0 0;padding-left:19px;color:var(--text-secondary,#475467);font-size:13px;line-height:1.7}li+li{margin-top:5px}
    .bonus-rule{margin-top:22px;padding-top:20px;border-top:1px solid var(--border,#d0d5dd)}.bonus-rule h3{font-size:15px;margin-bottom:12px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th{font-size:11px;color:var(--text-muted,#667085);font-weight:650;padding:8px 10px;background:var(--surface-muted,#f2f4f7)}td{padding:12px 10px;border-bottom:1px solid var(--border,#d0d5dd)}.award{font-weight:750;color:var(--activity-accent);white-space:nowrap}td:first-child{padding-left:10px}
    .example{padding:12px 14px;border-radius:10px;background:var(--accent-surface,#eef3ff);color:var(--text-secondary,#475467);font-size:13px;margin-top:16px}.example strong{color:var(--link,#244fc5);margin-right:6px}
    .policy-note{margin:24px 0;padding:20px 24px;border-left:3px solid var(--border-accent,#b8c8ed)}.policy-note h2{font-size:16px;margin-bottom:10px}.policy-note p{font-size:13px}.policy-note p+p{margin-top:8px}
    .versions{border:1px solid var(--border,#d0d5dd);box-shadow:none}.versions summary{cursor:pointer;font-weight:700}.versions summary span{font-size:12px;font-weight:400;color:var(--text-muted,#667085);margin-left:10px}.versions>p{font-size:13px;margin:14px 0}.versions small,.versions code{display:block;font-size:11px;margin-top:5px;color:var(--text-muted,#667085)}.dates{white-space:nowrap}.version-status{font-size:11px;padding:4px 7px;background:var(--surface-muted,#f2f4f7);border-radius:12px}.version-status.current{color:var(--success,#13795b);background:var(--success-surface,#eaf7ee)}
    @media(max-width:850px){.rules-grid{grid-template-columns:1fr}.score-equation{gap:12px;padding:18px}.score-equation strong{font-size:16px}}
    @media(max-width:560px){.score-equation{grid-template-columns:1fr;gap:12px}.score-equation>b{font-size:18px}.activity-card{padding:18px}.award{white-space:normal}.actions{width:100%;justify-content:space-between}}
  `],
})
export class RulesPageComponent implements OnInit, OnDestroy {
  readonly rules = signal<RuleVersion[]>([]);
  readonly date = signal(localCalendarDate());
  readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  readonly groups = computed(() => rulesGuideGroups(this.rules(), this.date()));
  readonly status = ruleStatus;
  private request?: Subscription;

  private readonly api = inject(RulesApiService);
  ngOnInit(): void { this.refresh(); }
  ngOnDestroy(): void { this.request?.unsubscribe(); }
  refresh(): void {
    this.request?.unsubscribe();
    this.date.set(localCalendarDate());
    this.state.set('loading');
    this.request = this.api.ruleVersions().subscribe({
      next: rules => { this.rules.set(rules); this.state.set('loaded'); },
      error: () => this.state.set('error'),
    });
  }
}
