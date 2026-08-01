import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExportsController } from './exports.controller.js';
import type { ExportsService } from './exports.service.js';

describe('ExportsController', () => {
  it('requires and forwards an inclusive bounded range', async () => {
    const service = { canonical: vi.fn().mockResolvedValue({ schemaVersion: 'sportos.canonical-export.v1' }) };
    const controller = new ExportsController(service as unknown as ExportsService);

    await expect(controller.canonical('2026-01-01', '2026-12-31')).resolves.toMatchObject({
      schemaVersion: 'sportos.canonical-export.v1',
    });
    expect(service.canonical).toHaveBeenCalledWith('2026-01-01', '2026-12-31');
  });

  it('rejects missing, impossible, reversed, and excessive ranges', async () => {
    const service = { canonical: vi.fn() };
    const controller = new ExportsController(service as unknown as ExportsService);

    await expect(controller.canonical(undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.canonical('2026-02-30', '2026-03-01')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.canonical('2026-03-02', '2026-03-01')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.canonical('2010-01-01', '2026-01-01')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.canonical).not.toHaveBeenCalled();
  });
});
