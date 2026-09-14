import '@angular/compiler';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import { RuleChangeAuditComponent } from './rule-change-audit.component';
import { RuleChangeStatusComponent } from './rule-change-status.component';
import { RuleImpactPreviewComponent } from './rule-impact-preview.component';
import { RuleProposalEditorComponent } from './rule-proposal-editor.component';
import { RuleVersionListComponent } from './rule-version-list.component';

describe('Rules Studio presentation components', () => {
  it('constructs all leaves without API dependencies', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const leaves = runInInjectionContext(injector, () => [
      new RuleVersionListComponent(),
      new RuleProposalEditorComponent(),
      new RuleImpactPreviewComponent(),
      new RuleChangeStatusComponent(),
      new RuleChangeAuditComponent(),
    ]);

    expect(leaves.map((component) => component.constructor.name)).toEqual([
      'RuleVersionListComponent',
      'RuleProposalEditorComponent',
      'RuleImpactPreviewComponent',
      'RuleChangeStatusComponent',
      'RuleChangeAuditComponent',
    ]);
    injector.destroy();
  });

  it('emits edit, preview, activation, cancel, and retry intents at leaf boundaries', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const { list, editor, preview, status } = runInInjectionContext(injector, () => ({
      list: new RuleVersionListComponent(),
      editor: new RuleProposalEditorComponent(),
      preview: new RuleImpactPreviewComponent(),
      status: new RuleChangeStatusComponent(),
    }));
    const intents: string[] = [];

    list.editRequested.subscribe(() => intents.push('edit'));
    editor.previewRequested.subscribe(() => intents.push('preview'));
    preview.activateRequested.subscribe(() => intents.push('activate'));
    status.cancelRequested.subscribe(() => intents.push('cancel'));
    status.retryRequested.subscribe(() => intents.push('retry'));

    list.editRequested.emit({} as never);
    editor.previewRequested.emit();
    preview.activateRequested.emit();
    status.cancelRequested.emit();
    status.retryRequested.emit();

    expect(intents).toEqual(['edit', 'preview', 'activate', 'cancel', 'retry']);
    injector.destroy();
  });
});
