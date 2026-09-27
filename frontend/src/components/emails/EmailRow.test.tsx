import type { EmailSummary } from '@outbox/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmailRow } from './EmailRow';

const mockScheduledEmail: EmailSummary = {
  id: 'email-1',
  campaignId: 'camp-1',
  to: 'john.smith@example.com',
  toName: 'John Smith',
  subject: 'Meeting follow-up',
  preview: 'Hi John, just wanted to follow up on our meeting...',
  status: 'scheduled',
  scheduledAt: '2026-10-15T09:15:12.000Z',
  sentAt: null,
  completedAt: null,
  deferCount: 0,
  lastDeferredReason: null,
  sender: { id: 'sender-1', fromEmail: 'oliver.brown@domain.io' },
};

const mockSentEmail: EmailSummary = {
  id: 'email-2',
  campaignId: 'camp-2',
  to: 'sarah.wilson@example.com',
  toName: 'Sarah Wilson',
  subject: 'Project Update',
  preview: 'Thanks for the update, Sarah. Looks good!',
  status: 'sent',
  scheduledAt: '2026-09-25T10:00:00.000Z',
  sentAt: '2026-09-25T10:00:05.000Z',
  completedAt: '2026-09-25T10:00:05.000Z',
  deferCount: 0,
  lastDeferredReason: null,
  sender: { id: 'sender-1', fromEmail: 'oliver.brown@domain.io' },
};

describe('EmailRow', () => {
  it('renders scheduled email row with recipient, subject, preview, and badge', () => {
    const onClick = vi.fn();
    render(<EmailRow email={mockScheduledEmail} folder="scheduled" onClick={onClick} />);

    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Meeting follow-up')).toBeInTheDocument();
    expect(
      screen.getByText('Hi John, just wanted to follow up on our meeting...'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Meeting follow-up'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders sent email row with Sent badge', () => {
    const onClick = vi.fn();
    render(<EmailRow email={mockSentEmail} folder="sent" onClick={onClick} />);

    expect(screen.getByText('Sarah Wilson')).toBeInTheDocument();
    expect(screen.getByText('Project Update')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });
});
