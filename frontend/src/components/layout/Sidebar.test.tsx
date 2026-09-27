import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
import { Sidebar } from './Sidebar';

vi.mock('../../api/client', () => ({
  api: {
    getMe: vi.fn().mockResolvedValue({
      id: 'user-1',
      name: 'Oliver Brown',
      email: 'oliver.brown@domain.io',
      avatarUrl: null,
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    getSlackStatus: vi.fn().mockResolvedValue({
      configured: true,
      connected: false,
    }),
    disconnectSlack: vi.fn().mockResolvedValue(undefined),
  },
  ApiError: class ApiError extends Error {},
}));

describe('Sidebar', () => {
  it('renders branding, compose button, scheduled and sent tabs with counts', () => {
    const onSelectTab = vi.fn();
    const onOpenCompose = vi.fn();

    render(
      <AuthProvider>
        <Sidebar
          currentTab="scheduled"
          onSelectTab={onSelectTab}
          onOpenCompose={onOpenCompose}
          counts={{ scheduled: 12, sent: 785 }}
        />
      </AuthProvider>,
    );

    expect(screen.getByText('ONB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Compose/i })).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('785')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sent'));
    expect(onSelectTab).toHaveBeenCalledWith('sent');

    fireEvent.click(screen.getByRole('button', { name: /Compose/i }));
    expect(onOpenCompose).toHaveBeenCalled();
  });

  it('renders Connect Slack action when Slack is configured but not connected', () => {
    render(
      <AuthProvider>
        <Sidebar
          currentTab="scheduled"
          onSelectTab={vi.fn()}
          onOpenCompose={vi.fn()}
          counts={{ scheduled: 0, sent: 0 }}
          slackStatus={{ configured: true, connected: false }}
        />
      </AuthProvider>,
    );

    expect(screen.getByText('Connect Slack')).toBeInTheDocument();
  });

  it('renders Slack connected state with team, channel and disconnect button', () => {
    const onRefreshSlack = vi.fn();
    render(
      <AuthProvider>
        <Sidebar
          currentTab="scheduled"
          onSelectTab={vi.fn()}
          onOpenCompose={vi.fn()}
          counts={{ scheduled: 0, sent: 0 }}
          slackStatus={{
            configured: true,
            connected: true,
            teamName: 'Acme Corp',
            channelName: '#notifications',
          }}
          onRefreshSlack={onRefreshSlack}
        />
      </AuthProvider>,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('#notifications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disconnect/i })).toBeInTheDocument();
  });
});
