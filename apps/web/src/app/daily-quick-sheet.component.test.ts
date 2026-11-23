import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { DailyQuickSheetComponent } from './daily-quick-sheet.component';

describe('DailyQuickSheetComponent mobile layout', () => {
  it('includes padding in the drawer width and uses a safe-area-aware phone layout', () => {
    // JSDOM does not calculate CSS min()/vw layouts; assert the CSS contract
    // that prevents the original content-box overflow regression.
    const styles = (DailyQuickSheetComponent as unknown as { ɵcmp: { styles: string[] } })
      .ɵcmp.styles.join('\n');

    expect(styles).toMatch(/\.sheet(?:\[[^\]]+\])?\s*\{[^}]*box-sizing:\s*border-box/);
    expect(styles).toMatch(/\.sheet(?:\[[^\]]+\])?\s*\{[^}]*max-width:\s*100%/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?\.sheet(?:\[[^\]]+\])?\s*\{[^}]*width:\s*100%/);
    expect(styles).toContain('safe-area-inset-left');
    expect(styles).toContain('safe-area-inset-right');
  });
});
