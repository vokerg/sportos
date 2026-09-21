export function describeProviderError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;

  const candidate = error as {
    status?: unknown;
    error?: unknown;
  };
  if (candidate.status === 0) return 'The SportOS API is unavailable.';

  const body = candidate.error && typeof candidate.error === 'object'
    ? candidate.error as { message?: unknown }
    : null;
  return typeof body?.message === 'string' && body.message.length > 0
    ? body.message
    : fallback;
}
