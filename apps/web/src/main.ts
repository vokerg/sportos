import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { provideEchartsCore } from 'ngx-echarts';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { AppComponent } from './app/app.component';
import { APP_ROUTES } from './app/app.routes';
import { authHttpInterceptor } from './app/auth-http.interceptor';

ModuleRegistry.registerModules([AllCommunityModule]);
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([authHttpInterceptor])),
    provideAnimations(),
    provideRouter(APP_ROUTES),
    provideEchartsCore({ echarts }),
  ],
}).catch((err) => console.error(err));
