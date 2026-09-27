import type { EmailStatus } from '@outbox/shared';
import React from 'react';
import { ClockIcon, Spinner } from './Icons';

interface BadgeProps {
  status: EmailStatus;
  label?: string;
  icon?: boolean;
  className?: string;
}

export function StatusBadge({ status, label, icon = true, className = '' }: BadgeProps) {
  switch (status) {
    case 'scheduled':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-13 font-medium bg-[var(--color-scheduled-bg)] border border-[var(--color-scheduled-border)] text-[var(--color-scheduled-fg)] shrink-0 ${className}`}
        >
          {icon && <ClockIcon className="w-3.5 h-3.5" />}
          <span>{label || 'Scheduled'}</span>
        </span>
      );
    case 'sending':
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-13 font-medium bg-blue-50 border border-blue-200 text-blue-700 shrink-0 ${className}`}
        >
          {icon && <Spinner className="w-3 h-3 text-blue-600" />}
          <span>{label || 'Sending'}</span>
        </span>
      );
    case 'sent':
      return (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-13 font-medium bg-[var(--color-sent-bg)] border border-[var(--color-sent-border)] text-[var(--color-sent-fg)] shrink-0 ${className}`}
        >
          <span>{label || 'Sent'}</span>
        </span>
      );
    case 'failed':
      return (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-13 font-medium bg-red-50 border border-red-200 text-red-700 shrink-0 ${className}`}
        >
          <span>{label || 'Failed'}</span>
        </span>
      );
  }
}
