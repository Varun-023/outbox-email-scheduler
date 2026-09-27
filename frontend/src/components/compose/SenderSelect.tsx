import type { Sender } from '@outbox/shared';
import React from 'react';
import { ChevronDownIcon, Spinner } from '../ui/Icons';

interface SenderSelectProps {
  senders: Sender[];
  selectedSenderId: string;
  onSelectSender: (senderId: string) => void;
  isLoading: boolean;
}

export function SenderSelect({
  senders,
  selectedSenderId,
  onSelectSender,
  isLoading,
}: SenderSelectProps) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-line-soft">
      <span className="w-16 text-13 text-[var(--color-ink-muted)] shrink-0 select-none">From</span>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)] py-1">
          <Spinner className="w-3.5 h-3.5 text-[var(--color-brand)]" />
          <span>Loading senders...</span>
        </div>
      ) : senders.length === 0 ? (
        <span className="text-xs text-amber-600">No senders available</span>
      ) : (
        <div className="relative inline-block">
          <select
            value={selectedSenderId}
            onChange={(e) => onSelectSender(e.target.value)}
            className="appearance-none bg-[var(--color-surface-muted)] hover:bg-gray-100 text-ink text-13 font-medium rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 cursor-pointer border border-transparent"
          >
            {senders.map((sender) => (
              <option key={sender.id} value={sender.id}>
                {sender.fromEmail}
              </option>
            ))}
          </select>
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
            <ChevronDownIcon className="w-3.5 h-3.5" />
          </div>
        </div>
      )}
    </div>
  );
}
