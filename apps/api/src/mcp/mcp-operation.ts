import { HttpException, ServiceUnavailableException } from '@nestjs/common';

/** Never let a database/SDK exception serialize or log authentication material. */
export async function mcpOperation<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('SportOS connection is temporarily unavailable.');
  }
}
