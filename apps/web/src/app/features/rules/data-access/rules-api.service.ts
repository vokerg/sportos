import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { RuleVersion } from '../model/rules.models';

@Injectable({ providedIn: 'root' })
export class RulesApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  ruleVersions() {
    return this.http.get<RuleVersion[]>(`${this.apiBase}/rules`);
  }
}
