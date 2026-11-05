/** Fixed ChatGPT callback; never follow an arbitrary URL returned by a request. */
export function isChatGptCallback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://chatgpt.com' && url.pathname === '/connector_platform_oauth_redirect'
      && !url.username && !url.password && !url.hash && url.searchParams.size === 3
      && /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code') ?? '')
      && !!url.searchParams.get('state') && !!url.searchParams.get('iss')
      && [...url.searchParams.keys()].every(key => ['code', 'state', 'iss'].includes(key));
  } catch { return false; }
}
