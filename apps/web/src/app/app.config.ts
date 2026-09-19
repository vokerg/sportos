import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { type ApplicationConfig } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { provideEchartsCore } from 'ngx-echarts';
import { APP_ROUTES } from './app.routes';
import { SPORTOS_API_BASE_PROVIDER } from './core/config/api-base';
import { authHttpInterceptor } from './core/http/auth-http.interceptor';

ModuleRegistry.registerModules([AllCommunityModule]);
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export const appConfig: ApplicationConfig = {
  providers: [
    SPORTOS_API_BASE_PROVIDER,
    provideHttpClient(withInterceptors([authHttpInterceptor])),
    provideAnimations(),
    provideRouter(APP_ROUTES),
    provideEchartsCore({ echarts }),
  ],
};
