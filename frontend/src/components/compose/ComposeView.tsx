import type { CreateCampaignRequest, Sender } from '@outbox/shared';
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { ParsedRecipient } from '../../utils/csv';
import { formatScheduledTime } from '../../utils/date';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { ArrowLeftIcon, ClockIcon, PaperclipIcon, Spinner, XIcon } from '../ui/Icons';
import { RecipientInput } from './RecipientInput';
import { RichEditor } from './RichEditor';
import { SenderSelect } from './SenderSelect';
import { SendLaterModal } from './SendLaterModal';

interface ComposeViewProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ComposeView({ onClose, onSuccess }: ComposeViewProps) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [isLoadingSenders, setIsLoadingSenders] = useState(true);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');

  const [recipients, setRecipients] = useState<ParsedRecipient[]>([]);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [delaySeconds, setDelaySeconds] = useState<string>('');
  const [hourlyLimit, setHourlyLimit] = useState<string>('');

  const [startAt, setStartAt] = useState<string | undefined>(undefined);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    accepted: number;
    duplicatesRemoved: number;
  } | null>(null);

  // Load available senders on mount
  useEffect(() => {
    let isMounted = true;
    async function loadSenders() {
      try {
        setIsLoadingSenders(true);
        const items = await api.getSenders();
        if (isMounted) {
          setSenders(items);
          if (items.length > 0 && items[0]) {
            setSelectedSenderId(items[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load senders:', err);
      } finally {
        if (isMounted) setIsLoadingSenders(false);
      }
    }
    loadSenders();
    return () => {
      isMounted = false;
    };
  }, []);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!selectedSenderId) {
      errors.senderId = 'Please select a sender.';
    }

    if (recipients.length === 0) {
      errors.recipients = 'At least one recipient is required.';
    }

    if (!subject.trim()) {
      errors.subject = 'Subject is required.';
    } else if (subject.length > 255) {
      errors.subject = 'Subject cannot exceed 255 characters.';
    }

    const plainBody = bodyHtml.replace(/<[^>]*>/g, '').trim();
    if (!plainBody && !bodyHtml.includes('<img') && !bodyHtml.includes('<blockquote')) {
      errors.bodyHtml = 'Email body cannot be empty.';
    }

    if (delaySeconds) {
      const d = Number(delaySeconds);
      if (isNaN(d) || d < 0 || d > 3600) {
        errors.delayBetweenEmailsSeconds = 'Delay must be between 0 and 3600 seconds.';
      }
    }

    if (hourlyLimit) {
      const h = Number(hourlyLimit);
      if (isNaN(h) || h < 1) {
        errors.hourlyLimit = 'Hourly limit must be at least 1.';
      }
    }

    if (startAt) {
      const startTime = new Date(startAt).getTime();
      const now = Date.now();
      if (startTime < now - 30000) {
        // give 30s grace period for clock skew
        errors.startAt = 'Scheduled time cannot be in the past.';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!validate()) return;

    try {
      setIsSubmitting(true);
      setServerError(null);

      const payload: CreateCampaignRequest = {
        senderId: selectedSenderId,
        subject: subject.trim(),
        bodyHtml: bodyHtml.trim(),
        recipients: recipients.map((r) => ({
          email: r.email,
          ...(r.name ? { name: r.name } : {}),
        })),
        ...(startAt ? { startAt } : {}),
        ...(delaySeconds ? { delayBetweenEmailsSeconds: parseInt(delaySeconds, 10) } : {}),
        ...(hourlyLimit ? { hourlyLimit: parseInt(hourlyLimit, 10) } : {}),
      };

      const idempotencyKey = generateIdempotencyKey();
      const response = await api.createCampaign(payload, idempotencyKey);

      setSuccessResult({
        accepted: response.recipients.accepted,
        duplicatesRemoved: response.recipients.duplicatesRemoved,
      });

      // Auto-navigate after brief moment
      setTimeout(() => {
        onSuccess();
      }, 1200);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details && err.details.length > 0) {
          const detailErrors: Record<string, string> = {};
          err.details.forEach((d) => {
            detailErrors[d.path] = d.message;
          });
          setFormErrors(detailErrors);
        }
        setServerError(err.message);
      } else if (err instanceof Error) {
        setServerError(err.message);
      } else {
        setServerError('An unexpected error occurred while scheduling email.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto relative">
      {/* Success Notification Modal / Overlay */}
      {successResult && (
        <div className="absolute inset-0 bg-white/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-line rounded-2xl shadow-xl p-8 max-w-sm w-full text-center animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-green-100 text-[var(--color-brand)] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-ink mb-1">
              {startAt ? 'Campaign Scheduled!' : 'Campaign Dispatched!'}
            </h3>
            <p className="text-xs text-[var(--color-ink-muted)] mb-4">
              {successResult.accepted} recipient{successResult.accepted === 1 ? '' : 's'} queued
              successfully.
              {successResult.duplicatesRemoved > 0 &&
                ` (${successResult.duplicatesRemoved} duplicate(s) removed)`}
            </p>
            <p className="text-xs text-green-700 font-medium">Redirecting to scheduled queue...</p>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="px-6 py-4 flex items-center justify-between border-b border-line-soft shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -ml-1.5 text-ink hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            aria-label="Back to dashboard"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <h1 className="text-base sm:text-lg font-bold text-ink">Compose New Email</h1>
        </div>

        {/* Right Top Action Buttons */}
        <div className="flex items-center gap-3 relative">
          {/* Scheduled Indicator Badge */}
          {startAt && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-scheduled-bg)] border border-[var(--color-scheduled-border)] text-13 font-medium text-[var(--color-scheduled-fg)]">
              <ClockIcon className="w-3.5 h-3.5" />
              <span>{formatScheduledTime(startAt)}</span>
              <button
                type="button"
                onClick={() => setStartAt(undefined)}
                className="hover:text-red-700 ml-1"
                aria-label="Clear schedule"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Attachment Paperclip */}
          <button
            type="button"
            className="p-2 text-ink hover:text-[var(--color-brand)] hover:bg-gray-100 rounded-full transition-colors cursor-pointer relative"
            title="Attachments"
            aria-label="Attachments"
          >
            <PaperclipIcon className="w-5 h-5" />
            <span className="absolute -top-0.5 -right-0.5 bg-[var(--color-brand-soft)] text-[var(--color-brand)] text-[10px] font-bold px-1 rounded-full border border-[var(--color-brand)]">
              1
            </span>
          </button>

          {/* Clock Icon (Schedule modal trigger) */}
          <button
            type="button"
            onClick={() => setShowScheduleModal(!showScheduleModal)}
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              startAt
                ? 'text-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                : 'text-ink hover:text-[var(--color-brand)] hover:bg-gray-100'
            }`}
            title="Schedule send time"
            aria-label="Schedule send time"
          >
            <ClockIcon className="w-5 h-5" />
          </button>

          {/* Send / Send Later Primary Button */}
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-full border border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] active:opacity-90 font-semibold text-sm transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
          >
            {isSubmitting && <Spinner className="w-4 h-4 text-[var(--color-brand)]" />}
            <span>{startAt ? 'Send Later' : 'Send'}</span>
          </button>

          {/* Send Later Popover */}
          {showScheduleModal && (
            <SendLaterModal
              currentScheduleDate={startAt}
              onConfirm={(iso) => {
                setStartAt(iso);
                setShowScheduleModal(false);
              }}
              onClose={() => setShowScheduleModal(false)}
            />
          )}
        </div>
      </div>

      {/* Server Error Alert */}
      {serverError && (
        <div className="mx-6 sm:mx-10 mt-4 p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between">
          <span>{serverError}</span>
          <button
            type="button"
            onClick={() => setServerError(null)}
            className="text-red-500 hover:text-red-800"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Form Fields Area */}
      <form onSubmit={handleSubmit} className="p-6 sm:p-10 max-w-5xl flex-1 flex flex-col">
        {/* From Row */}
        <SenderSelect
          senders={senders}
          selectedSenderId={selectedSenderId}
          onSelectSender={setSelectedSenderId}
          isLoading={isLoadingSenders}
        />
        {formErrors.senderId && (
          <p className="text-xs text-red-600 font-medium ml-16 mt-1">{formErrors.senderId}</p>
        )}

        {/* To Row */}
        <RecipientInput
          recipients={recipients}
          onChange={(recs) => {
            setRecipients(recs);
            if (formErrors.recipients) {
              setFormErrors((prev) => {
                const updated = { ...prev };
                delete updated.recipients;
                return updated;
              });
            }
          }}
          error={formErrors.recipients}
        />

        {/* Subject Row */}
        <div className="py-2.5 border-b border-line-soft flex items-center gap-3">
          <span className="w-16 text-13 text-[var(--color-ink-muted)] shrink-0 select-none">
            Subject
          </span>
          <input
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              if (formErrors.subject) {
                setFormErrors((prev) => {
                  const updated = { ...prev };
                  delete updated.subject;
                  return updated;
                });
              }
            }}
            placeholder="Subject"
            className="flex-1 text-13 text-ink placeholder:text-[var(--color-ink-subtle)] focus:outline-none bg-transparent py-0.5"
          />
        </div>
        {formErrors.subject && (
          <p className="text-xs text-red-600 font-medium ml-16 mt-1">{formErrors.subject}</p>
        )}

        {/* Delay and Hourly Limit Row matching Figma */}
        <div className="py-3 flex flex-wrap items-center gap-6">
          {/* Delay between 2 emails */}
          <div className="flex items-center gap-2">
            <span className="text-13 text-ink select-none">Delay between 2 emails</span>
            <input
              type="number"
              min="0"
              max="3600"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
              placeholder="00"
              className="w-16 px-2.5 py-1.5 text-13 text-center rounded-lg border border-line bg-white text-ink placeholder:text-gray-300 focus:outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]"
            />
            <span className="text-xs text-[var(--color-ink-muted)]">sec</span>
          </div>

          {/* Hourly Limit */}
          <div className="flex items-center gap-2">
            <span className="text-13 text-ink select-none">Hourly Limit</span>
            <input
              type="number"
              min="1"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              placeholder="00"
              className="w-16 px-2.5 py-1.5 text-13 text-center rounded-lg border border-line bg-white text-ink placeholder:text-gray-300 focus:outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]"
            />
          </div>
        </div>
        {formErrors.delayBetweenEmailsSeconds && (
          <p className="text-xs text-red-600 font-medium mb-1">
            {formErrors.delayBetweenEmailsSeconds}
          </p>
        )}
        {formErrors.hourlyLimit && (
          <p className="text-xs text-red-600 font-medium mb-1">{formErrors.hourlyLimit}</p>
        )}
        {formErrors.startAt && (
          <p className="text-xs text-red-600 font-medium mb-1">{formErrors.startAt}</p>
        )}

        {/* Rich Email Body Area */}
        <div className="flex-1 flex flex-col mt-2">
          <RichEditor
            value={bodyHtml}
            onChange={(html) => {
              setBodyHtml(html);
              if (formErrors.bodyHtml) {
                setFormErrors((prev) => {
                  const updated = { ...prev };
                  delete updated.bodyHtml;
                  return updated;
                });
              }
            }}
            placeholder="Type Your Reply..."
            error={formErrors.bodyHtml}
          />
        </div>
      </form>
    </div>
  );
}
