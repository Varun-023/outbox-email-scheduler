import type { EmailFolder, EmailSummary } from '@outbox/shared';
import React, { useState } from 'react';
import { formatScheduledTime } from '../../utils/date';
import { StatusBadge } from '../ui/Badge';
import { StarIcon } from '../ui/Icons';

interface EmailRowProps {
  email: EmailSummary;
  folder: EmailFolder;
  onClick: () => void;
}

export function EmailRow({ email, folder, onClick }: EmailRowProps) {
  const [isStarred, setIsStarred] = useState(false);

  const recipientLabel = email.toName ? email.toName : email.to;

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsStarred(!isStarred);
  };

  return (
    <div
      onClick={onClick}
      className="group flex items-center justify-between px-6 py-3.5 hover:bg-gray-50/80 border-b border-line-soft cursor-pointer transition-colors select-none"
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {/* Recipient info: "To: John Smith" */}
        <div className="w-36 sm:w-44 shrink-0 text-13 font-semibold text-ink truncate">
          <span className="text-[var(--color-ink-muted)] font-normal">To: </span>
          <span>{recipientLabel}</span>
        </div>

        {/* Status / Scheduled Time Badge */}
        <div className="shrink-0">
          {folder === 'scheduled' ? (
            <StatusBadge
              status={email.status}
              label={formatScheduledTime(email.scheduledAt)}
              icon={true}
            />
          ) : (
            <StatusBadge
              status={email.status}
              label={email.status === 'sent' ? 'Sent' : 'Failed'}
              icon={false}
            />
          )}
        </div>

        {/* Subject & Preview */}
        <div className="flex items-center gap-1.5 text-13 min-w-0 flex-1 truncate pr-4">
          <span className="font-semibold text-ink shrink-0 truncate max-w-[280px]">
            {email.subject}
          </span>
          <span className="text-gray-400 shrink-0 select-none">-</span>
          <span className="text-[var(--color-ink-muted)] truncate">{email.preview}</span>
        </div>
      </div>

      {/* Star Action */}
      <div className="shrink-0 pl-2">
        <button
          type="button"
          onClick={handleStarClick}
          className={`p-1.5 rounded hover:bg-gray-200 transition-colors cursor-pointer ${
            isStarred ? 'text-amber-500' : 'text-gray-300 hover:text-gray-500'
          }`}
          aria-label={isStarred ? 'Unstar email' : 'Star email'}
        >
          <StarIcon className="w-4 h-4" filled={isStarred} />
        </button>
      </div>
    </div>
  );
}
