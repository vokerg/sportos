import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type {
  RuleChange,
  RulePreviewResponse,
  RuleProposal,
  RuleVersion,
} from '../model/rules.models';

@Injectable({ providedIn: 'root' })
export class RulesApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  ruleVersions() {
    return this.http.get<RuleVersion[]>(`${this.apiBase}/rules`);
  }

  previewRule(proposal: RuleProposal) {
    return this.http.post<RulePreviewResponse>(`${this.apiBase}/rules/preview`, proposal);
  }

  activateRule(proposal: RuleProposal, previewFingerprint: string, reason: string) {
    return this.http.post<RuleChange>(`${this.apiBase}/rules/activate`, {
      proposal,
      previewFingerprint,
      reason,
      initiatedBy: 'local-user',
    });
  }

  ruleChanges(limit = 50) {
    return this.http.get<RuleChange[]>(`${this.apiBase}/rules/changes?limit=${limit}`);
  }

  ruleChange(changeId: string) {
    return this.http.get<RuleChange>(`${this.apiBase}/rules/changes/${encodeURIComponent(changeId)}`);
  }

  retryRuleChange(changeId: string) {
    return this.http.post<RuleChange>(`${this.apiBase}/rules/changes/${encodeURIComponent(changeId)}/retry`, {});
  }

  cancelRuleChange(changeId: string) {
    return this.http.post<RuleChange>(`${this.apiBase}/rules/changes/${encodeURIComponent(changeId)}/cancel`, {});
  }
}
