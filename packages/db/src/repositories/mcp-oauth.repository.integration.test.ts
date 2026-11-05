import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { AuthRepository } from './auth.repository.js';
import { McpOAuthRepository } from './mcp-oauth.repository.js';
const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const resource = 'https://api.sportos.example/mcp';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
integration('MCP OAuth with non-owner PostgreSQL roles', () => {
  let db: ReturnType<typeof createDb>, repo: McpOAuthRepository, auth: AuthRepository;
  const owners: string[] = [], sessions: string[] = [], requests: string[] = [];
  beforeAll(async () => {
    db = createDb(url!); repo = new McpOAuthRepository(db); auth = new AuthRepository(db);
    const role = (await sql<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>`select current_user as role, rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0];
    expect(role).toEqual({ role: 'sportos_app', rolsuper: false, rolbypassrls: false });
    for (let i = 0; i < 2; i++) {
      owners.push((await db.insertInto('accounts').values({ display_name: 'Synthetic MCP QA ' + i, email: null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id);
      sessions.push(await auth.createSession({ accountId: owners[i]!, tokenHash: hash(), csrfHash: hash(), userAgentHash: null,
        expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 7200000) }));
    }
  });
  afterAll(async () => {
    if (!db) return;
    if (requests.length) await db.deleteFrom('mcp_oauth_grants').where('request_hash', 'in', requests).execute();
    for (const owner of owners) await withAccountContext(db, owner, d => d.deleteFrom('daily_metrics').execute());
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
  });
  async function pending(expiresAt = new Date(Date.now() + 60000)) {
    const requestHash = hash(); requests.push(requestHash);
    await repo.create({ requestHash, clientId: 'sportos-chatgpt', redirectUri, resource,
      codeChallenge: 'c'.repeat(43), state: 'fixture', expiresAt });
    return requestHash;
  }
  async function approved(owner = 0) {
    const requestHash = await pending(), codeHash = hash();
    expect(await repo.approve({ requestHash, accountId: owners[owner]!, sessionId: sessions[owner]!, codeHash })).toBeTruthy();
    return { requestHash, codeHash };
  }
  const exchange = (codeHash: string, tokenHash = hash()) => ({ codeHash, tokenHash, codeChallenge: 'c'.repeat(43),
    clientId: 'sportos-chatgpt', redirectUri, resource, expiresAt: new Date(Date.now() + 43200000) });
  it('assigns only one approving owner and blocks cross-owner session links and reassignment', async () => {
    const requestHash = await pending();
    await expect(repo.approve({ requestHash, accountId: owners[0]!, sessionId: sessions[1]!, codeHash: hash() })).rejects.toMatchObject({ code: '23503' });
    const approvals = await Promise.all(owners.map((accountId, i) => repo.approve({ requestHash, accountId, sessionId: sessions[i]!, codeHash: hash() })));
    expect(approvals.filter(Boolean)).toHaveLength(1);
    const row = await db.selectFrom('mcp_oauth_grants').selectAll().where('request_hash', '=', requestHash).executeTakeFirstOrThrow();
    const other = row.account_id === owners[0] ? 1 : 0;
    await expect(db.updateTable('mcp_oauth_grants').set({ account_id: owners[other], session_id: sessions[other] }).where('request_hash', '=', requestHash).execute()).rejects.toThrow('immutable');
    await expect(db.updateTable('mcp_oauth_grants').set({ resource: 'https://other.example/mcp' }).where('request_hash', '=', requestHash).execute()).rejects.toThrow('immutable');
  });
  it('requires exact PKCE, resource, redirect and client; concurrent exchanges issue one token', async () => {
    const { codeHash } = await approved();
    for (const bad of [{ codeChallenge: 'x'.repeat(43) }, { resource: 'https://other.example/mcp' }, { redirectUri: 'https://other.example' }, { clientId: 'other' }]) {
      expect(await repo.exchange({ ...exchange(codeHash), ...bad })).toBeNull();
    }
    const a = exchange(codeHash), b = exchange(codeHash);
    const result = await Promise.all([repo.exchange(a), repo.exchange(b)]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const winner = result[0] ? a : b;
    expect(await repo.authenticate(winner.tokenHash, resource)).toBe(owners[0]);
    expect(await repo.authenticate(winner.tokenHash, 'https://other.example/mcp')).toBeNull();
    expect(await repo.exchange(exchange(codeHash))).toBeNull();
    expect(result.find(Boolean)!.valueOf()).toBeLessThan(Date.now() + 3600000);
  });
  it('resolves owner-bound reads through RLS and revokes only the selected account', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      await withAccountContext(db, owners[i]!, d => d.insertInto('daily_metrics').values({ metric_date: '2098-10-01',
        source_record_id: null, steps: i + 1, run_m: 0, bike_m: 0, swim_m: 0, workout_points: 0,
        base_points: 0, bonus_points: 0, total_points: 0, excel_all_points: null, excel_row_hash: null }).execute());
      const grant = await approved(i), input = exchange(grant.codeHash); tokens.push(input.tokenHash);
      await repo.exchange(input);
      const owner = await repo.authenticate(input.tokenHash, resource);
      const rows = await withAccountContext(db, owner!, d => d.selectFrom('daily_metrics').select('steps').execute());
      expect(rows.map(r => Number(r.steps))).toEqual([i + 1]);
      expect(await withAccountContext(db, owner!, d => d.selectFrom('daily_metrics').select('steps').where('owner_id', '=', owners[1 - i]!).execute())).toEqual([]);
    }
    expect(await db.selectFrom('daily_metrics').select('steps').execute()).toEqual([]);
    await repo.revokeAccount(owners[0]!);
    expect(await repo.authenticate(tokens[0]!, resource)).toBeNull();
    expect(await repo.authenticate(tokens[1]!, resource)).toBe(owners[1]);
    await repo.revokeToken(tokens[1]!, 'sportos-chatgpt');
    expect(await repo.authenticate(tokens[1]!, resource)).toBeNull();
  });
  it('denies expired requests, revoked/expired sessions and disabled accounts', async () => {
    const requestHash = await pending(new Date(Date.now() - 1000));
    expect(await repo.approve({ requestHash, accountId: owners[0]!, sessionId: sessions[0]!, codeHash: hash() })).toBeUndefined();
    const grant = await approved(1), input = exchange(grant.codeHash); await repo.exchange(input);
    await db.updateTable('accounts').set({ status: 'disabled' }).where('id', '=', owners[1]!).execute();
    expect(await repo.authenticate(input.tokenHash, resource)).toBeNull();
    await db.updateTable('accounts').set({ status: 'active' }).where('id', '=', owners[1]!).execute();
    const next = await approved(1);
    await auth.revokeSession(sessions[1]!);
    expect(await repo.authenticate(input.tokenHash, resource)).toBeNull();
    expect(await repo.exchange(exchange(next.codeHash))).toBeNull();
    await db.updateTable('auth_sessions').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', sessions[0]!).execute();
    const stale = await approved(0);
    expect(await repo.exchange(exchange(stale.codeHash))).toBeNull();
  });
  it('rejects expired retained tokens/codes and prevents replacing issued credentials', async () => {
    const sessionId = await auth.createSession({ accountId: owners[0]!, tokenHash: hash(), csrfHash: hash(), userAgentHash: null,
      expiresAt: new Date(Date.now() + 3600000), absoluteExpiresAt: new Date(Date.now() + 7200000) });
    const requestHash = hash(), tokenHash = hash(), codeHash = hash(); requests.push(requestHash);
    await db.insertInto('mcp_oauth_grants').values({ request_hash: requestHash, client_id: 'sportos-chatgpt',
      redirect_uri: redirectUri, resource, scope: 'athlete:read', code_challenge: 'c'.repeat(43), state: 'fixture',
      account_id: owners[0]!, session_id: sessionId, code_hash: codeHash, token_hash: tokenHash,
      created_at: new Date(Date.now() - 120000), request_expires_at: new Date(Date.now() - 60000),
      token_expires_at: new Date(Date.now() - 1000), revoked_at: null }).execute();
    expect(await repo.authenticate(tokenHash, resource)).toBeNull();
    expect(await repo.exchange(exchange(codeHash))).toBeNull();
    const expiredRequest = hash(), expiredCode = hash(); requests.push(expiredRequest);
    await db.insertInto('mcp_oauth_grants').values({ request_hash: expiredRequest, client_id: 'sportos-chatgpt',
      redirect_uri: redirectUri, resource, scope: 'athlete:read', code_challenge: 'c'.repeat(43), state: 'fixture',
      account_id: owners[0]!, session_id: sessionId, code_hash: expiredCode, token_hash: null,
      created_at: new Date(Date.now() - 120000), request_expires_at: new Date(Date.now() - 60000),
      token_expires_at: null, revoked_at: null }).execute();
    expect(await repo.exchange(exchange(expiredCode))).toBeNull();
    await expect(db.updateTable('mcp_oauth_grants').set({ token_hash: hash() }).where('request_hash', '=', requestHash).execute()).rejects.toThrow('immutable');
    await expect(db.updateTable('mcp_oauth_grants').set({ token_expires_at: new Date(Date.now() + 60000) }).where('request_hash', '=', requestHash).execute()).rejects.toThrow('immutable');
  });
  it('denies all worker/legacy/shared access and forces RLS', async () => {
    for (const role of ['sportos_worker', 'sportos_worker_data', 'sportos_legacy', 'sportos_data']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const row = (await sql<{ allowed: boolean }>`select has_table_privilege(${role}, 'mcp_oauth_grants', ${privilege}) as allowed`.execute(db)).rows[0];
        expect(row.allowed).toBe(false);
      }
    }
    expect((await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>`select relrowsecurity,relforcerowsecurity from pg_class where oid='mcp_oauth_grants'::regclass`.execute(db)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
