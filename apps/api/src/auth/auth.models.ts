export interface AuthenticatedAccount {
  id: string;
  displayName: string;
  email: string | null;
}

export interface AuthenticatedSession {
  id: string;
  account: AuthenticatedAccount;
  csrfHash: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

export interface AuthenticatedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  account?: AuthenticatedAccount;
  authSession?: AuthenticatedSession;
}
