import type { EmailFolder, EmailSummary } from '@outbox/shared';
import React from 'react';
import { Button } from '../ui/Button';
import { ClockIcon, SendIcon } from '../ui/Icons';
import { EmailRow } from './EmailRow';

interface EmailListProps {
  emails: EmailSummary[];
  folder: EmailFolder;
  isLoading: boolean;
  isLoadingMore?: boolean;
  error: string | null;
  searchQuery: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelectEmail: (id: string) => void;
  onRetry: () => void;
}

export function EmailList({
  emails,
  folder,
  isLoading,
  isLoadingMore = false,
  error,
  searchQuery,
  hasMore,
  onLoadMore,
  onSelectEmail,
  onRetry,
}: EmailListProps) {
  const displayEmails = emails;

  if (isLoading && emails.length === 0) {
    return (
      <div className="divide-y divide-line-soft">
        {[1, 2, 3, 4, 5, 6].map((idx) => (
          <div key={idx} className="flex items-center gap-4 px-6 py-4 animate-pulse">
            <div className="w-36 sm:w-44 h-4 bg-gray-200 rounded shrink-0" />
            <div className="w-28 h-6 bg-gray-100 rounded-full shrink-0" />
            <div className="flex-1 flex gap-2">
              <div className="w-48 h-4 bg-gray-200 rounded" />
              <div className="w-full h-4 bg-gray-100 rounded" />
            </div>
            <div className="w-4 h-4 bg-gray-200 rounded shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (error && emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-3">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-ink mb-1">Failed to load emails</h3>
        <p className="text-sm text-ink-muted mb-4 max-w-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (displayEmails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)] flex items-center justify-center mb-3">
          {folder === 'scheduled' ? (
            <ClockIcon className="w-6 h-6" />
          ) : (
            <SendIcon className="w-6 h-6" />
          )}
        </div>
        <h3 className="text-base font-semibold text-ink mb-1">
          {searchQuery
            ? 'No matching emails found'
            : folder === 'scheduled'
              ? 'No scheduled emails'
              : 'No sent emails'}
        </h3>
        <p className="text-sm text-ink-muted max-w-xs">
          {searchQuery
            ? `No emails found matching "${searchQuery}". Try a different search term.`
            : folder === 'scheduled'
              ? 'Scheduled emails will appear here before they are dispatched.'
              : 'Emails that have completed sending will appear in this list.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="divide-y divide-line-soft">
        {displayEmails.map((email) => (
          <EmailRow
            key={email.id}
            email={email}
            folder={folder}
            onClick={() => onSelectEmail(email.id)}
          />
        ))}
      </div>

      {hasMore && (
        <div className="p-6 text-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            isLoading={isLoadingMore}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
