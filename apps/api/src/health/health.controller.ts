import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from '../auth/public.decorator.js';

@Controller('health')
@PublicRoute()
export class HealthController {
  @Get()
  health() {
    return { ok: true, service: 'sportos-api' };
  }
}
