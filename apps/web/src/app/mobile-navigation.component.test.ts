// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { MobileMorePageComponent } from './mobile-more-page.component';
import { WebAuthService } from './web-auth.service';

@Component({ standalone: true, template: '' })
class EmptyPage {}

const auth = {
  state: signal<'authenticated'>('authenticated'),
  session: signal({ account: { id: '1', displayName: 'Test athlete', email: null } }),
  googleEnrollment: signal(false),
  linkingGoogle: signal(false),
  loadSession: vi.fn(),
  signOut: vi.fn(),
  enrollGoogle: vi.fn(),
};

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => { TestBed.resetTestingModule(); vi.clearAllMocks(); });

describe('mobile web navigation', () => {
  it('renders the five native-style tabs and tracks nested section routes', async () => {
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([
          { path: 'overview', component: EmptyPage },
          { path: 'daily/:date', component: EmptyPage },
          { path: 'activity/:id', component: EmptyPage },
          { path: 'stats/average-pace', component: EmptyPage },
          { path: 'run-lab', component: EmptyPage },
          { path: 'more', component: MobileMorePageComponent },
        ]),
        { provide: WebAuthService, useValue: auth },
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = [...root.querySelectorAll<HTMLAnchorElement>('.mobile-tabs a')];
    expect(tabs.map(link => link.textContent?.trim())).toEqual(['Home', 'Daily', 'Activities', 'Run Lab', 'More']);
    expect(tabs.map(link => link.getAttribute('href'))).toEqual(['/overview', '/daily', '/activities', '/run-lab', '/more']);
    expect(root.querySelector('.menu-toggle')).not.toBeNull(); // retained for tablet/desktop CSS

    const router = TestBed.inject(Router);
    for (const [url, title] of [
      ['/overview', 'Home'],
      ['/daily/2026-11-23', 'Daily'],
      ['/activity/abc', 'Activities'],
      ['/run-lab', 'Run Lab'],
      ['/stats/average-pace', 'More'],
      ['/more', 'More'],
    ]) {
      expect(await router.navigateByUrl(url)).toBe(true);
      fixture.detectChanges();
      const activeTabs = [...root.querySelectorAll<HTMLAnchorElement>('.mobile-tabs a[aria-current="page"]')];
      expect(activeTabs.map(link => link.textContent?.trim())).toEqual([title]);
    }
  });

  it('shows the More destinations and account controls', () => {
    TestBed.configureTestingModule({
      imports: [MobileMorePageComponent],
      providers: [provideRouter([]), { provide: WebAuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(MobileMorePageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect([...root.querySelectorAll<HTMLAnchorElement>('nav a')].map(link => link.getAttribute('href')))
      .toEqual(['/heatmap', '/dynamics', '/stats', '/chat', '/services']);
    expect(root.textContent).toContain('Test athlete');
    const signOut = [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Sign out');
    expect(signOut).toBeDefined();
    signOut!.click();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
