import '@angular/compiler';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { McpConnectApiService } from '../data-access/mcp-connect-api.service';
import { McpConnectStore } from './mcp-connect.store';
import { isChatGptCallback } from '../model/chatgpt-callback';
const callback = `https://chatgpt.com/connector_platform_oauth_redirect?code=${'c'.repeat(43)}&state=fixture&iss=https%3A%2F%2Fapi.example`;
const id = 'r'.repeat(43);
describe('ChatGPT browser approval', () => {
  it('does not approve on navigation and prevents repeated clicks', () => {
    const response = new Subject<{ redirectUrl: string }>();
    const api = { approve: vi.fn(() => response), disconnect: vi.fn() };
    const store = new McpConnectStore(api as unknown as McpConnectApiService);
    store.setRequest(id); expect(api.approve).not.toHaveBeenCalled();
    store.approve(); store.approve(); expect(api.approve).toHaveBeenCalledTimes(1);
    response.next({ redirectUrl: callback });
    expect(store.callback()).toBe(callback); expect(store.busy()).toBe(false);
    store.approve(); expect(api.approve).toHaveBeenCalledTimes(1); store.ngOnDestroy();
  });
  it('cancels stale approvals when the request or route changes', () => {
    const response = new Subject<{ redirectUrl: string }>();
    const api = { approve: vi.fn(() => response), disconnect: vi.fn() };
    const store = new McpConnectStore(api as unknown as McpConnectApiService);
    store.setRequest(id); store.approve(); expect(response.observed).toBe(true);
    store.setRequest('s'.repeat(43)); expect(response.observed).toBe(false);
    response.next({ redirectUrl: callback }); expect(store.callback()).toBeNull(); expect(store.busy()).toBe(false);
    store.approve(); store.ngOnDestroy(); expect(response.observed).toBe(false);
  });
  it('rejects malformed requests and untrusted redirects', () => {
    const api = { approve: vi.fn(() => of({ redirectUrl: 'https://evil.example' })), disconnect: vi.fn() };
    const store = new McpConnectStore(api as unknown as McpConnectApiService);
    store.setRequest('bad'); store.approve(); expect(api.approve).not.toHaveBeenCalled();
    store.setRequest(id); store.approve(); expect(store.callback()).toBeNull(); expect(store.message()).toContain('rejected');
    for (const value of ['https://evil.example', callback + '&extra=x', callback.replace('chatgpt.com', 'chatgpt.com.evil.example'),
      callback.replace('/connector_platform_oauth_redirect', '/other'), callback + '#fragment', callback.replace('https:', 'http:')]) {
      expect(isChatGptCallback(value)).toBe(false);
    }
    expect(isChatGptCallback(callback)).toBe(true);
  });
  it('allows manual retry after errors and revokes access explicitly', () => {
    const api = { approve: vi.fn(() => throwError(() => new Error('expired'))), disconnect: vi.fn(() => of({ revoked: true as const })) };
    const store = new McpConnectStore(api as unknown as McpConnectApiService);
    store.setRequest(id); store.approve(); expect(store.busy()).toBe(false); expect(store.message()).toContain('expired');
    store.approve(); expect(api.approve).toHaveBeenCalledTimes(2);
    store.disconnect(); expect(api.disconnect).toHaveBeenCalledTimes(1); expect(store.message()).toContain('revoked');
    expect(store.validRequest()).toBe(false); store.ngOnDestroy();
  });
});
