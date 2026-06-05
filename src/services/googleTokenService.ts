const TOKEN_KEY  = 'sk_g_token';
const EXPIRY_KEY = 'sk_g_expiry';
const SCOPES_KEY = 'sk_g_scopes';

export const GoogleTokenService = {
  set(token: string, expiresInSeconds = 3600, scopes: string[] = []): void {
    const expiresAt = Date.now() + (expiresInSeconds - 60) * 1000;
    localStorage.setItem(TOKEN_KEY,  token);
    localStorage.setItem(EXPIRY_KEY, String(expiresAt));
    localStorage.setItem(SCOPES_KEY, JSON.stringify(scopes));
  },

  get(): string | null {
    const expiry = Number(localStorage.getItem(EXPIRY_KEY) || 0);
    if (Date.now() >= expiry) return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  hasScope(scope: string): boolean {
    try {
      const scopes: string[] = JSON.parse(localStorage.getItem(SCOPES_KEY) || '[]');
      return scopes.includes(scope);
    } catch {
      return false;
    }
  },

  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    localStorage.removeItem(SCOPES_KEY);
  },
};
