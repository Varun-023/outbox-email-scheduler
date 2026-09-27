import React, { useState } from 'react';
import { toDateTimeLocalString } from '../../utils/date';
import { CalendarIcon } from '../ui/Icons';

interface SendLaterModalProps {
  currentScheduleDate?: string;
  onConfirm: (isoDate: string | undefined) => void;
  onClose: () => void;
}

export function SendLaterModal({ currentScheduleDate, onConfirm, onClose }: SendLaterModalProps) {
  // Compute default presets for tomorrow
  const now = new Date();

  const getTomorrowAt = (hours: number, minutes = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const tomorrow9AM = getTomorrowAt(9, 0);
  const tomorrow10AM = getTomorrowAt(10, 0);
  const tomorrow11AM = getTomorrowAt(11, 0);
  const tomorrow3PM = getTomorrowAt(15, 0);

  const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
    if (currentScheduleDate) {
      const parsed = new Date(currentScheduleDate);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return tomorrow9AM;
  });

  const [customInputValue, setCustomInputValue] = useState<string>(() => {
    if (currentScheduleDate) {
      const parsed = new Date(currentScheduleDate);
      if (!isNaN(parsed.getTime())) return toDateTimeLocalString(parsed);
    }
    return toDateTimeLocalString(tomorrow9AM);
  });

  const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomInputValue(val);
    if (val) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        setSelectedDate(d);
      }
    }
  };

  const handlePresetClick = (date: Date) => {
    setSelectedDate(date);
    setCustomInputValue(toDateTimeLocalString(date));
  };

  const handleDone = () => {
    if (selectedDate) {
      onConfirm(selectedDate.toISOString());
    } else {
      onConfirm(undefined);
    }
    onClose();
  };

  const isPresetActive = (targetDate: Date) => {
    if (!selectedDate) return false;
    return Math.abs(selectedDate.getTime() - targetDate.getTime()) < 1000;
  };

  return (
    <div className="absolute right-6 top-16 w-80 bg-white border border-line rounded-2xl shadow-xl p-5 z-50 select-none animate-in fade-in zoom-in-95 duration-150">
      <h3 className="text-sm font-bold text-ink mb-4">Send Later</h3>

      {/* Date & Time Picker */}
      <div className="relative mb-4">
        <input
          type="datetime-local"
          value={customInputValue}
          onChange={handleCustomDateChange}
          min={toDateTimeLocalString(new Date())}
          className="w-full text-xs text-ink bg-white border-b border-line py-2 pr-8 focus:outline-none focus:border-[var(--color-brand)] font-medium"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <CalendarIcon className="w-4 h-4" />
        </div>
      </div>

      {/* Preset List matching Figma */}
      <div className="space-y-1 mb-6 text-xs">
        <button
          type="button"
          onClick={() => handlePresetClick(tomorrow9AM)}
          className={`w-full text-left py-2 px-2.5 rounded-lg transition-colors cursor-pointer ${
            isPresetActive(tomorrow9AM)
              ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-semibold'
              : 'text-ink hover:bg-gray-50'
          }`}
        >
          Tomorrow
        </button>

        <button
          type="button"
          onClick={() => handlePresetClick(tomorrow10AM)}
          className={`w-full text-left py-2 px-2.5 rounded-lg transition-colors cursor-pointer ${
            isPresetActive(tomorrow10AM)
              ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-semibold'
              : 'text-ink hover:bg-gray-50'
          }`}
        >
          Tomorrow, 10:00 AM
        </button>

        <button
          type="button"
          onClick={() => handlePresetClick(tomorrow11AM)}
          className={`w-full text-left py-2 px-2.5 rounded-lg transition-colors cursor-pointer ${
            isPresetActive(tomorrow11AM)
              ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-semibold'
              : 'text-ink hover:bg-gray-50'
          }`}
        >
          Tomorrow, 11:00 AM
        </button>

        <button
          type="button"
          onClick={() => handlePresetClick(tomorrow3PM)}
          className={`w-full text-left py-2 px-2.5 rounded-lg transition-colors cursor-pointer ${
            isPresetActive(tomorrow3PM)
              ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-semibold'
              : 'text-ink hover:bg-gray-50'
          }`}
        >
          Tomorrow, 3:00 PM
        </button>
      </div>

      {/* Footer Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-ink-muted hover:text-ink px-3 py-1.5 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="text-xs font-semibold text-[var(--color-brand)] border border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] px-4 py-1.5 rounded-full transition-colors cursor-pointer active:opacity-90"
        >
          Done
        </button>
      </div>
    </div>
  );
}
