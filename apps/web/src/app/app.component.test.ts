// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { WebAuthService } from './web-auth.service';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

async function setup() {
  const auth = {
    state: () => 'authenticated',
    session: () => ({ account: { displayName: 'Test athlete' } }),
    googleEnrollment: () => false,
    loadSession: vi.fn(),
    signOut: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [provideRouter([]), { provide: WebAuthService, useValue: auth }],
  });
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  return { fixture, auth, el: fixture.nativeElement as HTMLElement };
}

describe('mobile navigation shell', () => {
  it('provides the same five primary destinations as native, with remaining sections in More', async () => {
    const { fixture, el, auth } = await setup();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.mobile-tab-bar a')];
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/overview', '/daily', '/activities', '/run-lab']);
    const more = el.querySelector<HTMLButtonElement>('.mobile-tab-bar button')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    fixture.detectChanges();

    const panel = el.querySelector<HTMLElement>('#mobile-more-panel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect([...panel.querySelectorAll<HTMLAnchorElement>('.more-links a')].map(a => a.getAttribute('href')))
      .toEqual(['/heatmap', '/dynamics', '/stats', '/chat', '/services']);
    expect(panel.textContent).toContain('Test athlete');

    panel.querySelector<HTMLButtonElement>('.more-heading button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('#mobile-more-panel')).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
    expect(auth.loadSession).toHaveBeenCalledOnce();
  });

  it('uses safe area side gutters and reserves room for the fixed phone tabs', () => {
    const css = (AppComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/);
    expect(css).toContain('.mobile-tab-bar');
    expect(css).toContain('position: fixed');
    expect(css).toContain('safe-area-inset-left');
    expect(css).toContain('safe-area-inset-right');
    expect(css).toContain('safe-area-inset-bottom');
    expect(css).toMatch(/\.page-shell(?:\[[^\]]+\])?\s*\{[^}]*112px/);
  });
});
