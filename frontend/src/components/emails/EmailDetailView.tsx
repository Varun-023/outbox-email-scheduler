import type { EmailDetail } from '@outbox/shared';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatEmailDetailDate } from '../../utils/date';
import { Avatar } from '../ui/Avatar';
import { StatusBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  Spinner,
  StarIcon,
  TrashIcon,
} from '../ui/Icons';

interface EmailDetailViewProps {
  emailId: string;
  onBack: () => void;
}

export function EmailDetailView({ emailId, onBack }: EmailDetailViewProps) {
  const { user } = useAuth();
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadDetail() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await api.getEmailDetail(emailId);
        if (isMounted) setEmail(data);
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load email details');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadDetail();
    return () => {
      isMounted = false;
    };
  }, [emailId]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12">
        <Spinner className="w-8 h-8 text-[var(--color-brand)] mb-3" />
        <p className="text-sm text-ink-muted">Loading email...</p>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
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
        <h3 className="text-base font-semibold text-ink mb-1">Failed to load email</h3>
        <p className="text-sm text-ink-muted mb-4">{error || 'Email not found'}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onBack}
          leftIcon={<ArrowLeftIcon className="w-4 h-4" />}
        >
          Back to list
        </Button>
      </div>
    );
  }

  const dateToShow = email.sentAt || email.scheduledAt;

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto">
      {/* Top Header Bar */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-line-soft shrink-0">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 -ml-1.5 text-ink hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <h1 className="text-base sm:text-lg font-bold text-ink truncate">{email.subject}</h1>
        </div>

        {/* Right Action Icons */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsStarred(!isStarred)}
            className={`p-2 rounded-full hover:bg-gray-100 transition-colors cursor-pointer ${
              isStarred ? 'text-amber-500' : 'text-gray-400 hover:text-ink'
            }`}
            aria-label="Star email"
          >
            <StarIcon className="w-4 h-4" filled={isStarred} />
          </button>
          <button
            type="button"
            className="p-2 text-gray-400 hover:text-ink hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            aria-label="Archive email"
          >
            <ArchiveIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="p-2 text-gray-400 hover:text-ink hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            aria-label="Delete email"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
          <div className="pl-2 border-l border-line-soft ml-1">
            <Avatar src={user?.avatarUrl} name={user?.name} email={user?.email} size="sm" />
          </div>
        </div>
      </div>

      {/* Main Email Content Container */}
      <div className="p-6 sm:p-10 max-w-4xl">
        {/* Sender & Recipient Information */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-start gap-3.5">
            <Avatar name={email.fromName || email.sender.fromEmail} size="md" />
            <div>
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="font-bold text-sm text-ink">{email.fromName || 'Sender'}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  &lt;{email.sender.fromEmail}&gt;
                </span>
              </div>
              <div className="relative mt-0.5">
                <button
                  type="button"
                  onClick={() => setShowMetadata(!showMetadata)}
                  className="text-xs text-[var(--color-ink-muted)] hover:text-ink flex items-center gap-1 cursor-pointer"
                >
                  <span>to {email.toName ? `${email.toName} <${email.to}>` : email.to}</span>
                  <ChevronDownIcon className="w-3 h-3 text-gray-400" />
                </button>

                {/* Detailed Metadata Popover */}
                {showMetadata && (
                  <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-line rounded-xl shadow-lg p-4 z-20 text-xs space-y-2">
                    <div className="flex justify-between py-1 border-b border-line-soft">
                      <span className="text-ink-muted">From:</span>
                      <span className="text-ink font-medium truncate max-w-[180px]">
                        {email.sender.fromEmail}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-line-soft">
                      <span className="text-ink-muted">To:</span>
                      <span className="text-ink font-medium truncate max-w-[180px]">
                        {email.to}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-line-soft">
                      <span className="text-ink-muted">Status:</span>
                      <span className="text-ink font-medium capitalize">{email.status}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-line-soft">
                      <span className="text-ink-muted">Scheduled:</span>
                      <span className="text-ink font-medium">
                        {new Date(email.scheduledAt).toLocaleString()}
                      </span>
                    </div>
                    {email.sentAt && (
                      <div className="flex justify-between py-1 border-b border-line-soft">
                        <span className="text-ink-muted">Sent:</span>
                        <span className="text-ink font-medium">
                          {new Date(email.sentAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {email.deferCount > 0 && (
                      <div className="flex justify-between py-1 border-b border-line-soft">
                        <span className="text-ink-muted">Deferred:</span>
                        <span className="text-amber-700 font-medium">
                          {email.deferCount} time(s) ({email.lastDeferredReason || 'rate limit'})
                        </span>
                      </div>
                    )}
                    {email.messageId && (
                      <div className="flex justify-between py-1 border-b border-line-soft">
                        <span className="text-ink-muted">Message ID:</span>
                        <span className="text-ink font-mono text-[10px] truncate max-w-[180px]">
                          {email.messageId}
                        </span>
                      </div>
                    )}
                    {email.campaign && (
                      <div className="flex justify-between py-1">
                        <span className="text-ink-muted">Rate limit:</span>
                        <span className="text-ink">
                          {email.campaign.effectiveHourlyLimit}/hr (gap{' '}
                          {email.campaign.effectiveDelaySeconds}s)
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className="text-xs text-[var(--color-ink-muted)]">
              {formatEmailDetailDate(dateToShow)}
            </span>
            <StatusBadge status={email.status} />
          </div>
        </div>

        {/* Ethereal Preview URL Banner if available */}
        {email.previewUrl && (
          <div className="mb-6 p-3 bg-blue-50/80 border border-blue-200 rounded-xl flex items-center justify-between text-xs">
            <span className="text-blue-900 font-medium">
              Ethereal Test Inbox: Message delivered to test mailbox
            </span>
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand)] font-semibold hover:underline flex items-center gap-1 shrink-0 ml-2"
            >
              View on Ethereal &rarr;
            </a>
          </div>
        )}

        {/* Error Banner if failed */}
        {email.status === 'failed' && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
            <p className="font-semibold mb-1">Delivery Failed ({email.errorCode || 'UNKNOWN'})</p>
            <p className="text-red-700">
              {email.errorMessage || 'Could not deliver email to recipient.'}
            </p>
          </div>
        )}

        {/* Email Body */}
        <div className="email-body-content text-ink text-sm leading-relaxed space-y-4 pt-2">
          <div
            dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
            className="prose prose-sm max-w-none [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--color-callout-bar)] [&_blockquote]:bg-[var(--color-callout-bg)] [&_blockquote]:p-4 [&_blockquote]:rounded-r-lg [&_blockquote]:my-4 [&_blockquote]:font-medium [&_a]:text-[var(--color-brand)] [&_a]:underline"
          />
        </div>
      </div>
    </div>
  );
}
