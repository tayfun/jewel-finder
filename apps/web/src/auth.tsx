import type { Account, AuthResponse, Credentials } from "@jf/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import { Sentry } from "./sentry";

interface AuthState {
  account: Account | null;
  loading: boolean;
  login(creds: Credentials): Promise<void>;
  register(creds: Credentials): Promise<void>;
  logout(): void;
  setAccount(account: Account): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);

  const logout = useCallback(() => {
    setToken(null);
    setAccount(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api<Account>("/api/me")
      .then(setAccount)
      .catch(logout)
      .finally(() => setLoading(false));
  }, [logout]);

  // Tag errors with the account id (never the email).
  useEffect(() => {
    Sentry.setUser(account ? { id: account.id } : null);
  }, [account]);

  const value = useMemo<AuthState>(() => {
    const signIn = (path: string) => async (creds: Credentials) => {
      const res = await api<AuthResponse>(path, { json: creds });
      setToken(res.token);
      setAccount(res.account);
    };
    return {
      account,
      loading,
      login: signIn("/api/auth/login"),
      register: signIn("/api/auth/register"),
      logout,
      setAccount,
    };
  }, [account, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** Only for pages behind <RequireAuth>, where the account is guaranteed. */
export function useAccount(): Account {
  const { account } = useAuth();
  if (!account) throw new Error("useAccount without a signed-in account");
  return account;
}
