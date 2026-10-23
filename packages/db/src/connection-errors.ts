/** Connection failures only: never retry arbitrary SQL or application errors. */
export function isDatabaseConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && (
    code.startsWith('08') || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
      'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P02', '57P03'].includes(code)
  )) return true;
  // pg emits these connection lifecycle failures without SQLSTATE/errno codes.
  return [
    'Connection terminated unexpectedly', 'Connection terminated',
    'Client has encountered a connection error and is not queryable',
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
  ].includes(error.message);
}
