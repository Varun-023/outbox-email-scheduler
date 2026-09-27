import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
import { LoginPage } from './LoginPage';

vi.mock('../../api/client', () => ({
  api: {
    getMe: vi.fn().mockRejectedValue(new Error('Unauthorized')),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  ApiError: class ApiError extends Error {
    statusCode = 401;
  },
}));

describe('LoginPage', () => {
  it('renders login title and Google sign-in button', () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Login with Google/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email ID')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Login$/i })).toBeInTheDocument();
  });
});
