import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./api/client', () => ({
  api: {
    getMe: vi.fn(),
    getEmailCounts: vi.fn().mockResolvedValue({ scheduled: 5, sent: 10 }),
    listEmails: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getSenders: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  ApiError: class ApiError extends Error {},
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login page when user is not authenticated', async () => {
    const { api } = await import('./api/client');
    (api.getMe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Unauthorized'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeInTheDocument();
    });
  });

  it('renders dashboard shell when user is authenticated', async () => {
    const { api } = await import('./api/client');
    (api.getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      name: 'Oliver Brown',
      email: 'oliver.brown@domain.io',
      avatarUrl: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('ONB')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Compose/i })).toBeInTheDocument();
      expect(screen.getByText('Scheduled')).toBeInTheDocument();
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });
  });
});
