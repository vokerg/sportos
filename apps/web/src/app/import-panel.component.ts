import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { ApiService } from './api.service';

@Component({
  selector: 'sportos-import-panel',
  standalone: true,
  imports: [FormsModule, JsonPipe],
  template: `
    <section class="card">
      <h2>Import local files</h2>
      <p>For MVP-0 this endpoint imports files by server-local path. Later this becomes a browser upload + background job.</p>
      <div class="form-row">
        <input [(ngModel)]="mySportPath" placeholder="/absolute/path/my_sport.xlsx">
        <input [(ngModel)]="runDbPath" placeholder="/absolute/path/run-db.xlsx">
        <button (click)="import()">Import</button>
      </div>
      @if (result()) {
        <pre>{{ result() | json }}</pre>
      }
    </section>
  `,
})
export class ImportPanelComponent {
  mySportPath = '';
  runDbPath = '';
  readonly result = signal<unknown>(null);

  constructor(private readonly api: ApiService) {}

  import() {
    this.api.importLocalFiles(this.mySportPath || undefined, this.runDbPath || undefined).subscribe((result) => this.result.set(result));
  }
}
