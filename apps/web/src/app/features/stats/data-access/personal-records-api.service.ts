import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { PersonalRecordsResponse } from '../model/personal-records.models';

@Injectable({ providedIn: 'root' })
export class PersonalRecordsApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);
  private readonly http = inject(HttpClient);

  read(to: string) {
    return this.http.get<PersonalRecordsResponse>(`${this.apiBase}/stats/personal-records`, { params: { to } });
  }
}
