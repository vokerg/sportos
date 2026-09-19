export function isSportosApiRequest(
  requestUrl: string,
  browserOrigin: string,
  apiBase: string,
): boolean {
  try {
    return new URL(requestUrl, browserOrigin).origin === new URL(apiBase, browserOrigin).origin;
  } catch {
    return false;
  }
}
