import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ComposeView } from './ComposeView';

vi.mock('../../api/client', () => ({
  api: {
    getSenders: vi.fn().mockResolvedValue([
      {
        id: 'sender-1',
        label: 'Oliver Brown',
        fromName: 'Oliver Brown',
        fromEmail: 'oliver.brown@domain.io',
        provider: 'ethereal',
        hourlyLimit: 100,
        minDelayMs: 2000,
      },
    ]),
    createCampaign: vi.fn().mockResolvedValue({
      campaign: {
        id: 'camp-1',
        senderId: 'sender-1',
        subject: 'Test Subject',
        recipientCount: 1,
        startAt: '2026-09-28T10:00:00.000Z',
        effectiveDelaySeconds: 0,
        effectiveHourlyLimit: 100,
        firstScheduledAt: '2026-09-28T10:00:00.000Z',
        lastScheduledAt: '2026-09-28T10:00:00.000Z',
        queueStatus: 'queued',
        createdAt: '2026-09-28T09:00:00.000Z',
      },
      recipients: { accepted: 1, duplicatesRemoved: 0 },
    }),
  },
  ApiError: class ApiError extends Error {},
}));

describe('ComposeView', () => {
  it('renders compose form fields matching Figma', async () => {
    render(<ComposeView onClose={vi.fn()} onSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: 'Compose New Email' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
    expect(screen.getByText('Subject')).toBeInTheDocument();
    expect(screen.getByText('Delay between 2 emails')).toBeInTheDocument();
    expect(screen.getByText('Hourly Limit')).toBeInTheDocument();
    expect(screen.getByText('Upload List')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send$/i })).toBeInTheDocument();
  });

  it('validates required fields before submitting', async () => {
    render(<ComposeView onClose={vi.fn()} onSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Send$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(screen.getByText('At least one recipient is required.')).toBeInTheDocument();
      expect(screen.getByText('Subject is required.')).toBeInTheDocument();
    });
  });
});
