import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
import { EmailDetailView } from './EmailDetailView';

vi.mock('../../api/client', () => ({
  api: {
    getMe: vi.fn().mockResolvedValue({
      id: 'user-1',
      name: 'Oliver Brown',
      email: 'oliver.brown@domain.io',
      avatarUrl: null,
    }),
    getEmailDetail: vi.fn().mockResolvedValue({
      id: 'email-1',
      campaignId: 'camp-1',
      to: 'recipient@example.com',
      toName: 'Oliver',
      subject: 'Oliver, hello there!',
      preview: 'You just received something...',
      bodyHtml: '<p>You have just RECEIVED something</p>',
      fromName: 'Amanda Clark',
      status: 'sent',
      scheduledAt: '2026-11-03T10:23:00.000Z',
      sentAt: '2026-11-03T10:23:02.000Z',
      completedAt: '2026-11-03T10:23:02.000Z',
      deferCount: 0,
      lastDeferredReason: null,
      attemptCount: 1,
      messageId: 'msg-12345',
      previewUrl: 'https://ethereal.email/message/xyz',
      errorCode: null,
      errorMessage: null,
      originalScheduledAt: '2026-11-03T10:23:00.000Z',
      sender: { id: 'sender-1', fromEmail: 'sender@example.com' },
      campaign: {
        id: 'camp-1',
        effectiveDelaySeconds: 5,
        effectiveHourlyLimit: 100,
        recipientCount: 1,
      },
    }),
  },
  ApiError: class ApiError extends Error {},
}));

describe('EmailDetailView', () => {
  it('loads and renders email details, sender, recipient, and preview link', async () => {
    const onBack = vi.fn();
    render(
      <AuthProvider>
        <EmailDetailView emailId="email-1" onBack={onBack} />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: 'Oliver, hello there!' }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Amanda Clark')).toBeInTheDocument();
    expect(screen.getByText(/You have just RECEIVED something/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View on Ethereal/i })).toBeInTheDocument();
  });
});
