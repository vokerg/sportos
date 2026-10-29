import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  athleteSnapshotSchema,
  bestInput,
  bestOutput,
  detailsInput,
  detailOutput,
  errorSchema,
  searchInput,
  searchOutput,
  snapshotInput,
  volumeInput,
  volumeOutput,
} from './contracts.js';
import { AthleteReadService, ToolError } from './service.js';
export interface ReadFailure {
  code: 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_INPUT' | 'BUSY' | 'OUTPUT_LIMIT';
  sqlState: string | null;
}
export function createServer(service: AthleteReadService, onReadFailure?: (failure: ReadFailure) => void) {
  const server = new McpServer({ name: 'sportos-readonly', version: '0.1.0' });
  let active = false;
  let windowStart = Date.now(),
    requests = 0;
  const register = (
    name: string,
    description: string,
    inputSchema: z.ZodType,
    outputSchema: z.ZodType,
    run: (input: unknown) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        outputSchema: z.union([outputSchema, errorSchema]),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        if (active)
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: {
                    code: 'BUSY',
                    message: 'A read is already in progress; retry after completion.',
                  },
                }),
              },
            ],
            structuredContent: {
              error: {
                code: 'BUSY',
                message: 'A read is already in progress; retry after completion.',
              },
            },
          };
        if (Date.now() - windowStart >= 60000) {
          windowStart = Date.now();
          requests = 0;
        }
        if (++requests > 30) {
          const result = {
            error: { code: 'BUSY', message: 'Local request limit reached. Retry in one minute.' },
          };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }
        active = true;
        try {
          const result = outputSchema.parse(await run(input));
          const text = JSON.stringify(result);
          if (Buffer.byteLength(text) > 2000000)
            throw new ToolError(
              'OUTPUT_LIMIT',
              'Result exceeds the bounded response limit. Narrow the request.',
            );
          return {
            content: [{ type: 'text' as const, text }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          const e =
            error instanceof ToolError
              ? error
              : new ToolError(
                  error instanceof z.ZodError ? 'INVALID_INPUT' : 'UNAVAILABLE',
                  error instanceof z.ZodError
                    ? 'Input or retained output does not match the contract.'
                    : 'Retained evidence is unavailable. Check local runtime configuration.',
                );
          const rawCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
          onReadFailure?.({ code: e.code, sqlState: typeof rawCode === 'string' && /^[0-9A-Z]{5}$/.test(rawCode) ? rawCode : null });
          const result = { error: { code: e.code, message: e.message } };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } finally {
          active = false;
        }
      },
    );
  };
  register(
    'get_athlete_snapshot',
    'Versioned deduplicated canonical run/bike/swim snapshot. Excludes the current incomplete local day; no downloads or writes.',
    snapshotInput,
    athleteSnapshotSchema,
    (i) => service.snapshot(i),
  );
  register(
    'get_training_volume',
    'Calendar totals in metres/seconds; weekly buckets start Monday. Empty buckets mean no retained sessions. Paginated archive view.',
    volumeInput,
    volumeOutput,
    (i) => service.volume(i),
  );
  register(
    'get_personal_bests',
    'Run: explicit supported distanceM, historical imported vs calculated continuous efforts. Bike/swim: whole activities only, 1% distance tolerance, exact metrics retained.',
    bestInput,
    bestOutput,
    (i) => service.bests(i),
  );
  register(
    'search_activities',
    'Canonical UUIDs only; bounded page, inclusive source-local dates, elapsed duration filters, moving pace with elapsed fallback, deterministic date/UUID order.',
    searchInput,
    searchOutput,
    (i) => service.search(i),
  );
  register(
    'get_activity_details',
    'One canonical activity, current compact metric provenance and retained current laps where configured. No narrative, routes, raw bodies or provider calls.',
    detailsInput,
    detailOutput,
    (i) => service.details(i),
  );
  return server;
}
