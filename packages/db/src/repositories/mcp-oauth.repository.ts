import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

/** Authentication control plane, not a canonical-data repository. API role only. */
export class McpOAuthRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: { requestHash: string; clientId: string; redirectUri: string;
    resource: string; codeChallenge: string; state: string; expiresAt: Date }) {
    const now = new Date();
    await this.db.deleteFrom('mcp_oauth_grants')
      .where('request_expires_at', '<=', now)
      .where(eb => eb.or([eb('token_expires_at', 'is', null), eb('token_expires_at', '<=', now)]))
      .execute();
    await this.db.insertInto('mcp_oauth_grants').values({
      request_hash: input.requestHash, client_id: input.clientId, redirect_uri: input.redirectUri,
      resource: input.resource, scope: 'athlete:read', code_challenge: input.codeChallenge,
      state: input.state, request_expires_at: input.expiresAt,
      account_id: null, session_id: null, code_hash: null, token_hash: null,
      token_expires_at: null, revoked_at: null,
    }).execute();
  }

  async approve(input: { requestHash: string; accountId: string; sessionId: string; codeHash: string }) {
    // A single UPDATE assigns the owner once. The composite FK binds the approving session.
    return this.db.updateTable('mcp_oauth_grants').set({ account_id: input.accountId,
      session_id: input.sessionId, code_hash: input.codeHash })
      .where('request_hash', '=', input.requestHash).where('account_id', 'is', null)
      .where('revoked_at', 'is', null).where('request_expires_at', '>', new Date())
      .returning(['redirect_uri', 'state']).executeTakeFirst();
  }

  async exchange(input: { codeHash: string; codeChallenge: string; clientId: string;
    redirectUri: string; resource: string; tokenHash: string; expiresAt: Date }) {
    // Row lock + transaction prevents concurrent exchanges; failures do not consume a code.
    return this.db.transaction().execute(async tx => {
      const now = new Date();
      const grant = await tx.selectFrom('mcp_oauth_grants as grant')
        .innerJoin('auth_sessions as session', 'session.id', 'grant.session_id')
        .innerJoin('accounts as account', 'account.id', 'grant.account_id')
        .select(['grant.request_hash', 'session.expires_at', 'session.absolute_expires_at'])
        .where('grant.code_hash', '=', input.codeHash).where('grant.code_challenge', '=', input.codeChallenge)
        .where('grant.client_id', '=', input.clientId).where('grant.redirect_uri', '=', input.redirectUri)
        .where('grant.resource', '=', input.resource).where('grant.scope', '=', 'athlete:read')
        .where('grant.token_hash', 'is', null).where('grant.revoked_at', 'is', null)
        .where('grant.request_expires_at', '>', now).where('session.revoked_at', 'is', null)
        .where('session.expires_at', '>', now).where('session.absolute_expires_at', '>', now)
        .where('account.status', '=', 'active').forUpdate('grant').executeTakeFirst();
      if (!grant) return null;
      const expiresAt = new Date(Math.min(input.expiresAt.valueOf(),
        new Date(grant.expires_at).valueOf(), new Date(grant.absolute_expires_at).valueOf()));
      await tx.updateTable('mcp_oauth_grants').set({ token_hash: input.tokenHash, token_expires_at: expiresAt })
        .where('request_hash', '=', grant.request_hash).execute();
      return expiresAt;
    });
  }

  async authenticate(tokenHash: string, resource: string) {
    const now = new Date();
    const row = await this.db.selectFrom('mcp_oauth_grants as grant')
      .innerJoin('auth_sessions as session', 'session.id', 'grant.session_id')
      .innerJoin('accounts as account', 'account.id', 'grant.account_id')
      .select('grant.account_id').where('grant.token_hash', '=', tokenHash)
      .where('grant.resource', '=', resource).where('grant.scope', '=', 'athlete:read')
      .where('grant.revoked_at', 'is', null).where('grant.token_expires_at', '>', now)
      .where('session.revoked_at', 'is', null).where('session.expires_at', '>', now)
      .where('session.absolute_expires_at', '>', now).where('account.status', '=', 'active').executeTakeFirst();
    return row?.account_id ?? null;
  }

  async revokeToken(tokenHash: string, clientId: string) {
    await this.db.updateTable('mcp_oauth_grants').set({ revoked_at: new Date() })
      .where('token_hash', '=', tokenHash).where('client_id', '=', clientId)
      .where('revoked_at', 'is', null).execute();
  }

  async revokeAccount(accountId: string) {
    await this.db.updateTable('mcp_oauth_grants').set({ revoked_at: new Date() })
      .where('account_id', '=', accountId).where('revoked_at', 'is', null).execute();
  }
}
