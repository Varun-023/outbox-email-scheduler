import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { GoogleIcon } from '../ui/Icons';

export function LoginPage() {
  const { loginWithGoogle, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  // Check URL search params for error message passed from backend OAuth callback
  const searchParams = new URLSearchParams(window.location.search);
  const errorCode = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    GOOGLE_AUTH_DISABLED: 'Google OAuth is not configured on the server.',
    OAUTH_STATE_MISMATCH: 'Security check failed. Please try signing in again.',
    OAUTH_CONSENT_DENIED: 'Google sign-in was cancelled or consent was denied.',
    EMAIL_NOT_VERIFIED: 'Your Google email account is not verified.',
    OAUTH_EXCHANGE_FAILED: 'Failed to authenticate with Google. Please try again.',
  };

  const handleEmailLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalMessage(
      'Email/password login is simulated for design parity. Please use "Login with Google".',
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-[420px] rounded-2xl border border-gray-100 p-8 sm:p-10 shadow-sm bg-white">
        <h1 className="text-3xl font-bold text-center text-ink tracking-tight mb-8">Login</h1>

        {errorCode && (
          <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {errorMessages[errorCode] || `Authentication error: ${errorCode}`}
          </div>
        )}

        {localMessage && (
          <div className="mb-6 p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            {localMessage}
          </div>
        )}

        {/* Login with Google Button */}
        <button
          type="button"
          onClick={() => loginWithGoogle('/')}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-lg bg-[var(--color-brand-soft)] hover:bg-green-100 active:bg-green-200 transition-colors text-ink text-sm font-medium cursor-pointer disabled:opacity-50"
        >
          <GoogleIcon className="w-5 h-5" />
          <span>Login with Google</span>
        </button>

        {/* Divider */}
        <div className="relative flex items-center justify-center my-7">
          <div className="w-full border-t border-gray-200" />
          <span className="absolute bg-white px-3 text-xs text-gray-400 select-none">
            or sign up through email
          </span>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleEmailLoginSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder="Email ID"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[var(--color-surface-muted)] text-sm rounded-lg px-4 py-3 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:bg-white border border-transparent focus:border-[var(--color-brand)] text-ink"
            />
          </div>

          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--color-surface-muted)] text-sm rounded-lg px-4 py-3 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 focus:bg-white border border-transparent focus:border-[var(--color-brand)] text-ink"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 px-4 mt-2 rounded-lg bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] text-white text-sm font-medium transition-colors cursor-pointer shadow-sm active:opacity-95"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
