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
      !url.username && !url.password && !url.hash && Array.from(url.searchParams).length === 1 &&
      !!url.searchParams.get('request');
  } catch { return false; }
}

/** Public origin scopes Keychain storage; a different deployment must sign in afresh. */
export function sessionStorageKey(origin) {
  if (!isExactOrigin(origin, true)) throw new Error('Invalid API origin');
  const normalized = new URL(origin).origin;
  return 'sportos.mobile.session.v2.' + Array.from(normalized, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
