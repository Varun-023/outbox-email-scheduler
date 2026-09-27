import type { AuthUser } from '@outbox/shared';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  loginWithGoogle: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const currentUser = await api.getMe();
      setUser(currentUser);
      setError(null);
    } catch (err) {
      setUser(null);
      if (err instanceof ApiError && err.statusCode === 401) {
        setError(null);
      } else if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api
      .getMe()
      .then((currentUser) => {
        if (!ignore) {
          setUser(currentUser);
          setError(null);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setUser(null);
          if (!(err instanceof ApiError && err.statusCode === 401)) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
          }
          setIsLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const loginWithGoogle = (returnTo = '/') => {
    window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      setUser(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        loginWithGoogle,
        logout,
        refetchUser: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
