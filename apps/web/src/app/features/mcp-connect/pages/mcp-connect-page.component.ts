import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { McpConnectStore } from '../state/mcp-connect.store';

@Component({
  selector: 'sportos-mcp-connect', standalone: true, providers: [McpConnectStore],
  template: `
    <section class="card connect" aria-labelledby="mcp-connect-title">
      <h1 id="mcp-connect-title">Connect ChatGPT to SportOS</h1>
      <p>Approve only if you started this connection in ChatGPT. ChatGPT will be able to
        read your retained run, bike and swim training history, totals, personal bests and activity metrics.</p>
      <p>Access is read-only for up to 12 hours and ends when the approving SportOS session
        expires or signs out. Reconnect after expiry. Provider downloads and changes to your data are unavailable.</p>
      @if (store.message()) { <p role="status">{{ store.message() }}</p> }
      @if (store.validRequest() && !store.callback()) {
        <button type="button" [disabled]="store.busy()" (click)="store.approve()">
          {{ store.busy() ? 'Connecting…' : 'Approve read-only access' }}
        </button>
      }
      @if (store.callback()) {
        <a class="button" [href]="store.callback()">Return to ChatGPT</a>
      }
      @if (!store.validRequest() && !store.message()) {
        <p>Start a new connection from the SportOS plugin in ChatGPT.</p>
      }
      <button type="button" [disabled]="store.busy()" (click)="store.disconnect()">Revoke all ChatGPT access</button>
    </section>
  `,
  styles: [`.connect { max-width: 600px; margin: 32px auto; padding: 28px; }
    button, .button { display: inline-block; min-height: 44px; margin: 12px 12px 0 0; }`],
})
export class McpConnectPageComponent {
  readonly store = inject(McpConnectStore);
  constructor() {
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(query => this.store.setRequest(query.get('request')));
  }
}
