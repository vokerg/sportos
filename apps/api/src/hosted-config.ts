import { mcpConfig } from './mcp/mcp-oauth.service.js';
import { googleEnrollmentEnabled } from './auth/google-owner-auth.js';

export function validateHostedEnvironment(env: NodeJS.ProcessEnv): void {
  mcpConfig(env);
  if (env.NODE_ENV !== 'production') return;
  if (env.SPORTOS_AUTH_MODE === 'dev-single-user' || env.SPORTOS_DEV_AUTH_TOKEN) {
    throw new Error('Development authentication is forbidden in production.');
  }
  for (const name of ['SPORTOS_WEB_ORIGIN', 'SPORTOS_API_ORIGIN']) {
    const url = new URL(env[name] ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(`${name} must be an HTTPS deployment URL.`);
    }
  }
  const enrollingGoogle = googleEnrollmentEnabled(env);
  if (enrollingGoogle || env.SPORTOS_AUTH_MODE === 'single-user-google') {
    if (!env.SPORTOS_OIDC_CLIENT_ID?.trim() || !env.SPORTOS_OIDC_CLIENT_SECRET?.trim()
      || (enrollingGoogle && !/^[^\s@]+@[^\s@]+$/.test(env.SPORTOS_GOOGLE_OWNER_EMAIL?.trim() ?? ''))) {
      throw new Error('Personal Google sign-in is not configured.');
    }
  }
  if (env.SPORTOS_AUTH_MODE === 'single-user-google') return;
  if (env.SPORTOS_AUTH_MODE === 'single-user') {
    if (!env.SPORTOS_SINGLE_USER_USERNAME?.trim()
      || !/^scrypt-v1:[0-9a-f]{32}:[0-9a-f]{128}$/.test(env.SPORTOS_SINGLE_USER_PASSWORD_HASH ?? '')) {
      throw new Error('Single-user credentials are not configured.');
    }
  } else if (env.SPORTOS_AUTH_MODE || !env.SPORTOS_OIDC_ISSUER || !env.SPORTOS_OIDC_CLIENT_ID) {
    throw new Error('A supported hosted authentication mode must be configured.');
  }
}
