/** Native-only browser handoff URL policy: exact configured web origin and expected route. */
export function isExactOrigin(origin, allowLocal = false) {
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    const secure = url.protocol === 'https:' ||
      (allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
    return secure && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === '/' && (origin === url.origin || origin === url.origin + '/');
  } catch { return false; }
}

export function validAuthorizationUrl(urlValue, webOrigin, allowLocal = false) {
  if (!isExactOrigin(webOrigin, allowLocal)) return false;
  try {
    const url = new URL(urlValue);
    return url.origin === new URL(webOrigin).origin && url.pathname === '/mobile-connect' &&
      !url.username && !url.password && !url.hash && url.searchParams.size === 1 &&
      !!url.searchParams.get('request');
  } catch { return false; }
}
