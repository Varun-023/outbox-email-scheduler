import { isValidEmail, normalizeEmail } from '@outbox/shared';
import React, { useRef, useState } from 'react';
import { parseRecipientsText, type ParsedRecipient } from '../../utils/csv';
import { UploadIcon, XIcon } from '../ui/Icons';

interface RecipientInputProps {
  recipients: ParsedRecipient[];
  onChange: (recipients: ParsedRecipient[]) => void;
  error?: string;
}

export function RecipientInput({ recipients, onChange, error }: RecipientInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [showAllChips, setShowAllChips] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const addRecipient = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Support comma or space separated batch in text input
    if (trimmed.includes(',') || trimmed.includes(' ')) {
      const parsedResult = parseRecipientsText(trimmed);
      if (parsedResult.recipients.length > 0) {
        const existingEmails = new Set(recipients.map((r) => r.email));
        const newOnes = parsedResult.recipients.filter((r) => !existingEmails.has(r.email));
        if (newOnes.length > 0) {
          onChange([...recipients, ...newOnes]);
        }
        setInputValue('');
        return;
      }
    }

    const email = normalizeEmail(trimmed);
    if (!isValidEmail(email)) {
      setUploadNotice(`"${trimmed}" is not a valid email address.`);
      setTimeout(() => setUploadNotice(null), 3000);
      return;
    }

    if (recipients.some((r) => r.email === email)) {
      setInputValue('');
      return;
    }

    onChange([...recipients, { email }]);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      e.preventDefault();
      addRecipient(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      onChange(recipients.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addRecipient(inputValue);
    }
  };

  const removeRecipient = (indexToRemove: number) => {
    onChange(recipients.filter((_, i) => i !== indexToRemove));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const result = parseRecipientsText(text);
      if (result.recipients.length === 0) {
        setUploadNotice('No valid email addresses found in the uploaded file.');
        setTimeout(() => setUploadNotice(null), 4000);
        return;
      }

      const existingEmails = new Set(recipients.map((r) => r.email));
      const newlyAdded = result.recipients.filter((r) => !existingEmails.has(r.email));
      const combined = [...recipients, ...newlyAdded];
      onChange(combined);

      let msg = `Loaded ${result.recipients.length} recipients.`;
      if (result.duplicateCount > 0) {
        msg += ` (${result.duplicateCount} duplicate(s) skipped)`;
      }
      if (result.invalidCount > 0) {
        msg += ` (${result.invalidCount} invalid format(s) ignored)`;
      }
      setUploadNotice(msg);
      setTimeout(() => setUploadNotice(null), 5000);
    };

    reader.readAsText(file);
    // Reset file input so user can upload the same file again if desired
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Chips display: Show first 3 by default, and `+N` badge unless expanded
  const maxVisibleChips = 3;
  const visibleRecipients = showAllChips ? recipients : recipients.slice(0, maxVisibleChips);
  const hiddenCount = recipients.length - maxVisibleChips;

  return (
    <div className="py-2.5 border-b border-line-soft">
      <div className="flex items-start justify-between gap-3">
        <span className="w-16 text-13 text-[var(--color-ink-muted)] shrink-0 pt-1 select-none">
          To
        </span>

        {/* Recipient Chips and Text Input */}
        <div
          className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[32px] cursor-text"
          onClick={() => textInputRef.current?.focus()}
        >
          {visibleRecipients.map((recipient, idx) => (
            <span
              key={recipient.email}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-ink group"
            >
              <span>
                {recipient.name ? `${recipient.name} (${recipient.email})` : recipient.email}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecipient(idx);
                }}
                className="text-gray-400 hover:text-red-600 rounded-full cursor-pointer"
                aria-label={`Remove ${recipient.email}`}
              >
                <XIcon className="w-3 h-3" />
              </button>
            </span>
          ))}

          {!showAllChips && hiddenCount > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAllChips(true);
              }}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border border-[var(--color-brand)] text-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] transition-colors cursor-pointer"
            >
              +{hiddenCount}
            </button>
          )}

          {showAllChips && recipients.length > maxVisibleChips && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAllChips(false);
              }}
              className="text-xs text-[var(--color-brand)] hover:underline cursor-pointer px-1"
            >
              Collapse
            </button>
          )}

          <input
            ref={textInputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={recipients.length === 0 ? 'recipient@example.com' : 'Add more...'}
            className="flex-1 min-w-[140px] text-13 text-ink placeholder:text-[var(--color-ink-subtle)] focus:outline-none bg-transparent py-0.5"
          />
        </div>

        {/* Upload List Button */}
        <div className="shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="hidden"
            id="recipient-file-upload"
          />
          <label
            htmlFor="recipient-file-upload"
            className="inline-flex items-center gap-1.5 text-13 font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)] transition-colors cursor-pointer select-none py-1 px-2 rounded-lg hover:bg-[var(--color-brand-soft)]"
          >
            <UploadIcon className="w-4 h-4 text-[var(--color-brand)]" />
            <span>Upload List</span>
          </label>
        </div>
      </div>

      {/* Notice / Status feedback for file uploads or invalid items */}
      {uploadNotice && (
        <div className="mt-2 ml-16 text-xs text-[var(--color-brand-hover)] bg-green-50 p-2 rounded-lg border border-green-200">
          {uploadNotice}
        </div>
      )}

      {error && <p className="mt-1.5 ml-16 text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}
