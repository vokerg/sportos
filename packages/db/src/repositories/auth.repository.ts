import { sql, type Kysely } from 'kysely';
import type { Account, Database } from '../schema.js';

export interface AuthTransactionReadModel {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

export interface AuthenticatedSessionReadModel {
  sessionId: string;
  account: {
    id: string;
    displayName: string;
    email: string | null;
  };
  csrfHash: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  lastSeenAt: string;
}

export interface ExternalIdentityInput {
  issuer: string;
  subject: string;
  email?: string | null;
  displayName?: string | null;
  preferredAccountId?: string | null;
}

export class ExternalIdentityClaimError extends Error {
  constructor() {
    super('The configured account is unavailable or has already been claimed.');
    this.name = 'ExternalIdentityClaimError';
  }
}

const IDENTITY_PROVISION_LOCK = 834_110_214;

export class AuthRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createAuthorizationTransaction(input: {
    stateHash: string;
    codeVerifier: string;
    nonce: string;
    returnTo: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.deleteFrom('auth_transactions').where('expires_at', '<=', new Date()).execute();
    await this.db.insertInto('auth_transactions').values({
      state_hash: input.stateHash,
      code_verifier: input.codeVerifier,
      nonce: input.nonce,
      return_to: input.returnTo,
      expires_at: input.expiresAt,
    }).execute();
  }

  async consumeAuthorizationTransaction(stateHash: string): Promise<AuthTransactionReadModel | null> {
    return this.db.transaction().execute(async (transaction) => {
      const row = await transaction
        .deleteFrom('auth_transactions')
        .where('state_hash', '=', stateHash)
        .where('expires_at', '>', new Date())
        .returning(['code_verifier', 'nonce', 'return_to'])
        .executeTakeFirst();
      return row ? { codeVerifier: row.code_verifier, nonce: row.nonce, returnTo: row.return_to } : null;
    });
  }

  async provisionExternalIdentity(input: ExternalIdentityInput): Promise<Account> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${IDENTITY_PROVISION_LOCK})`.execute(transaction);
      const existing = await transaction
        .selectFrom('external_identities as identity')
        .innerJoin('accounts as account', 'account.id', 'identity.account_id')
        .selectAll('account')
        .where('identity.issuer', '=', input.issuer)
        .where('identity.subject', '=', input.subject)
        .executeTakeFirst();

      if (existing) {
        const displayName = normalizeDisplayName(input.displayName, input.email, existing.display_name);
        await transaction.updateTable('accounts').set({
          display_name: displayName,
          email: normalizeEmail(input.email) ?? existing.email,
          updated_at: new Date(),
        }).where('id', '=', existing.id).execute();
        await transaction.updateTable('external_identities').set({
          email: normalizeEmail(input.email),
          display_name: displayName,
          last_login_at: new Date(),
        }).where('issuer', '=', input.issuer).where('subject', '=', input.subject).execute();
        return { ...existing, display_name: displayName, email: normalizeEmail(input.email) ?? existing.email };
      }

      let account: Account;
      if (input.preferredAccountId) {
        const claimed = await transaction
          .selectFrom('external_identities')
          .select('id')
          .where('account_id', '=', input.preferredAccountId)
          .executeTakeFirst();
        const preferred = await transaction
          .selectFrom('accounts')
          .selectAll()
          .where('id', '=', input.preferredAccountId)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (claimed || !preferred) throw new ExternalIdentityClaimError();

        account = await transaction.updateTable('accounts').set({
          display_name: normalizeDisplayName(input.displayName, input.email, preferred.display_name),
          email: normalizeEmail(input.email) ?? preferred.email,
          updated_at: new Date(),
        }).where('id', '=', preferred.id).returningAll().executeTakeFirstOrThrow();
      } else {
        account = await transaction.insertInto('accounts').values({
          display_name: normalizeDisplayName(input.displayName, input.email, 'SportOS athlete'),
          email: normalizeEmail(input.email),
          status: 'active',
        }).returningAll().executeTakeFirstOrThrow();
      }

      await transaction.insertInto('external_identities').values({
        account_id: account.id,
        issuer: input.issuer,
        subject: input.subject,
        email: normalizeEmail(input.email),
        display_name: normalizeDisplayName(input.displayName, input.email, account.display_name),
      }).execute();

      await sql`select set_config('sportos.account_id', ${account.id}, true)`.execute(transaction);
      await sql`select sportos_seed_account_rules(${account.id}::uuid)`.execute(transaction);
      return account;
    });
  }

  async createSession(input: {
    accountId: string;
    tokenHash: string;
    csrfHash: string;
    userAgentHash: string | null;
    expiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<string> {
    const row = await this.db.insertInto('auth_sessions').values({
      account_id: input.accountId,
      token_hash: input.tokenHash,
      csrf_hash: input.csrfHash,
      user_agent_hash: input.userAgentHash,
      expires_at: input.expiresAt,
      absolute_expires_at: input.absoluteExpiresAt,
      revoked_at: null,
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  async findActiveSession(tokenHash: string): Promise<AuthenticatedSessionReadModel | null> {
    const now = new Date();
    const row = await this.db
      .selectFrom('auth_sessions as session')
      .innerJoin('accounts as account', 'account.id', 'session.account_id')
      .select([
        'session.id as sessionId',
        'session.csrf_hash as csrfHash',
        'session.expires_at as expiresAt',
        'session.absolute_expires_at as absoluteExpiresAt',
        'session.last_seen_at as lastSeenAt',
        'account.id as accountId',
        'account.display_name as displayName',
        'account.email as email',
      ])
      .where('session.token_hash', '=', tokenHash)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', now)
      .where('session.absolute_expires_at', '>', now)
      .where('account.status', '=', 'active')
      .executeTakeFirst();
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      account: { id: row.accountId, displayName: row.displayName, email: row.email },
      csrfHash: row.csrfHash,
      expiresAt: toIso(row.expiresAt),
      absoluteExpiresAt: toIso(row.absoluteExpiresAt),
      lastSeenAt: toIso(row.lastSeenAt),
    };
  }

  async touchSession(sessionId: string, expiresAt: Date): Promise<void> {
    await this.db.updateTable('auth_sessions').set({
      last_seen_at: new Date(),
      expires_at: expiresAt,
    }).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.updateTable('auth_sessions').set({ revoked_at: new Date() }).where('id', '=', sessionId).execute();
  }

  getAccount(accountId: string): Promise<Account | undefined> {
    return this.db.selectFrom('accounts').selectAll().where('id', '=', accountId).where('status', '=', 'active').executeTakeFirst();
  }
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized && normalized.length <= 320 ? normalized : null;
}

function normalizeDisplayName(value: string | null | undefined, email: string | null | undefined, fallback: string): string {
  const candidate = String(value ?? '').trim() || normalizeEmail(email)?.split('@')[0] || fallback;
  return candidate.slice(0, 200) || 'SportOS athlete';
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) throw new TypeError('Expected a database timestamp.');
  return parsed.toISOString();
}
