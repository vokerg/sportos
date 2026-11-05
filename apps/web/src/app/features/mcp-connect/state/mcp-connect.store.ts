import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { McpConnectApiService } from '../data-access/mcp-connect-api.service';
import { isChatGptCallback } from '../model/chatgpt-callback';

@Injectable()
export class McpConnectStore implements OnDestroy {
  readonly busy = signal(false);
  readonly validRequest = signal(false);
  readonly callback = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  private requestId = '';
  private pending?: Subscription;
  private generation = 0;
  constructor(private readonly api: McpConnectApiService) {}
  setRequest(value: string | null) {
    this.pending?.unsubscribe(); this.generation++;
    this.requestId = value ?? '';
    this.validRequest.set(/^[A-Za-z0-9_-]{43}$/.test(this.requestId));
    this.callback.set(null); this.message.set(null); this.busy.set(false);
  }
  approve() {
    if (this.busy() || !this.validRequest() || this.callback()) return;
    const generation = this.generation;
    this.busy.set(true); this.message.set(null);
    this.pending = this.api.approve(this.requestId).subscribe({
      next: ({ redirectUrl }) => {
        if (generation !== this.generation) return;
        this.busy.set(false);
        if (!isChatGptCallback(redirectUrl)) { this.message.set('The ChatGPT callback was rejected.'); return; }
        this.callback.set(redirectUrl);
        this.message.set('Approved. Return to ChatGPT to finish connecting.');
      },
      error: () => {
        if (generation !== this.generation) return;
        this.busy.set(false); this.message.set('Approval failed or expired. Restart the connection in ChatGPT.');
      },
    });
  }
  disconnect() {
    if (this.busy()) return;
    this.busy.set(true); this.message.set(null); this.callback.set(null);
    const generation = this.generation;
    this.pending = this.api.disconnect().subscribe({
      next: () => {
        if (generation !== this.generation) return;
        this.busy.set(false); this.validRequest.set(false); this.message.set('All ChatGPT connections to your SportOS account were revoked.');
      },
      error: () => {
        if (generation !== this.generation) return;
        this.busy.set(false); this.message.set('Could not revoke access. Please retry.');
      },
    });
  }
  ngOnDestroy() { this.generation++; this.pending?.unsubscribe(); }
}
