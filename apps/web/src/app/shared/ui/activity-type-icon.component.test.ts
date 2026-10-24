// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ActivityTypeIconComponent, type ActivityIconType } from './activity-type-icon.component';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

describe('activity type icon', () => {
  it.each(['steps', 'walk', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus'] as ActivityIconType[])('renders an identifiable %s mark', activityType => {
    const fixture = TestBed.createComponent(ActivityTypeIconComponent);
    fixture.componentInstance.activityType = activityType;
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path, circle').length).toBeGreaterThan(0);
  });

  it('exposes a label when used as the only activity mark', () => {
    const fixture = TestBed.createComponent(ActivityTypeIconComponent);
    fixture.componentInstance.activityType = 'swim';
    fixture.componentInstance.label = 'Swim';
    fixture.componentInstance.decorative = false;
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Swim');
    expect(svg.querySelector('title')?.textContent).toBe('Swim');
  });
});
