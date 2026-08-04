export const SPORTOS_API_ORIGIN = 'http://localhost:3000';

export function isSportosApiRequest(
  requestUrl: string,
  browserOrigin: string,
  apiOrigin = SPORTOS_API_ORIGIN,
): boolean {
  try {
    return new URL(requestUrl, browserOrigin).origin === new URL(apiOrigin).origin;
  } catch {
    return false;
  }
}
