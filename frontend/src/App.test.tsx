import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./api/client', () => ({
  api: {
    getMe: vi.fn(),
    getEmailCounts: vi.fn().mockResolvedValue({ scheduled: 5, sent: 10 }),
    listEmails: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    searchEmails: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getSenders: vi.fn().mockResolvedValue([]),
    getSlackStatus: vi.fn().mockResolvedValue({ configured: true, connected: false }),
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

  it('performs Elasticsearch search when user types in search bar', async () => {
    const { api } = await import('./api/client');
    (api.getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      name: 'Oliver Brown',
      email: 'oliver.brown@domain.io',
      avatarUrl: null,
    });
    (api.searchEmails as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        {
          id: 'email-search-1',
          campaignId: 'camp-1',
          to: 'client@example.com',
          toName: 'Client',
          subject: 'Elasticsearch Indexing Meeting',
          preview: 'Discussion on search results',
          status: 'scheduled',
          scheduledAt: new Date().toISOString(),
          sentAt: null,
          completedAt: null,
          deferCount: 0,
          lastDeferredReason: null,
          sender: { id: 's1', fromEmail: 'sender@ethereal.test' },
        },
      ],
      nextCursor: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search');
    fireEvent.change(searchInput, { target: { value: 'Elasticsearch' } });

    await waitFor(() => {
      expect(api.searchEmails).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Elasticsearch' }),
      );
      expect(screen.getByText('Elasticsearch Indexing Meeting')).toBeInTheDocument();
    });
  });
});
