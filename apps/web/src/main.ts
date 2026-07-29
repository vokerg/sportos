import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { provideEchartsCore } from 'ngx-echarts';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { AppComponent } from './app/app.component';

ModuleRegistry.registerModules([AllCommunityModule]);
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideAnimations(), provideEchartsCore({ echarts })],
}).catch((err) => console.error(err));
