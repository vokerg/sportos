import type { GeneratedTimestamp, NullableTimestamp, Timestamp } from './schema.js';

/** API-only authentication control plane; account binding is assigned on approval. */
export interface McpOAuthGrantsTable {
  request_hash: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  scope: 'athlete:read';
  code_challenge: string;
  state: string;
  account_id: string | null;
  session_id: string | null;
  code_hash: string | null;
  token_hash: string | null;
  request_expires_at: Timestamp;
  token_expires_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}
