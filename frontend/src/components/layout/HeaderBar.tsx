import type { EmailStatus } from '@outbox/shared';
import React, { useEffect, useRef, useState } from 'react';
import { FilterIcon, RefreshIcon, SearchIcon } from '../ui/Icons';
import type { NavTab } from './Sidebar';

interface HeaderBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentTab: NavTab;
  statusFilter?: EmailStatus;
  onStatusFilterChange: (status?: EmailStatus) => void;
  rescheduledFilter?: boolean;
  onRescheduledFilterChange: (rescheduled?: boolean) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenMobileSidebar?: () => void;
}

export function HeaderBar({
  searchQuery,
  onSearchChange,
  currentTab,
  statusFilter,
  onStatusFilterChange,
  rescheduledFilter,
  onRescheduledFilterChange,
  onRefresh,
  isRefreshing,
  onOpenMobileSidebar,
}: HeaderBarProps) {
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasActiveFilter = Boolean(statusFilter || rescheduledFilter !== undefined);

  return (
    <header className="px-6 py-4 flex items-center justify-between gap-4 border-b border-line-soft bg-white">
      {/* Mobile hamburger button */}
      {onOpenMobileSidebar && (
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          className="md:hidden p-2 text-gray-500 hover:text-ink rounded-lg hover:bg-gray-100"
          aria-label="Open sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      )}

      {/* Search Bar */}
      <div className="flex-1 max-w-xl relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
          <SearchIcon className="w-4 h-4" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search"
          className="w-full pl-9 pr-4 py-2 bg-[var(--color-surface-muted)] text-sm rounded-full text-ink placeholder:text-[var(--color-ink-subtle)] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-brand)]/20 border border-transparent focus:border-[var(--color-brand)] transition-colors"
        />
      </div>

      {/* Action buttons (Filter & Refresh) */}
      <div className="flex items-center gap-2">
        {/* Filter popover button */}
        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              hasActiveFilter
                ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
                : 'text-gray-400 hover:text-ink hover:bg-gray-100'
            }`}
            title="Filter emails"
            aria-label="Filter emails"
          >
            <FilterIcon className="w-4 h-4" />
          </button>

          {showFilterMenu && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-line rounded-xl shadow-lg p-3 z-50 text-xs">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-line">
                <span className="font-semibold text-ink">Filter by Status</span>
                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      onStatusFilterChange(undefined);
                      onRescheduledFilterChange(undefined);
                    }}
                    className="text-[11px] text-[var(--color-brand)] hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {currentTab === 'scheduled' ? (
                  <>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        checked={!statusFilter}
                        onChange={() => onStatusFilterChange(undefined)}
                        className="text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                      />
                      <span>All Scheduled</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        checked={statusFilter === 'scheduled'}
                        onChange={() => onStatusFilterChange('scheduled')}
                        className="text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                      />
                      <span>Scheduled only</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        checked={statusFilter === 'sending'}
                        onChange={() => onStatusFilterChange('sending')}
                        className="text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                      />
                      <span>Sending only</span>
                    </label>

                    <div className="pt-2 mt-1 border-t border-line">
                      <span className="font-semibold text-ink block mb-1.5">Rescheduled</span>
                      <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rescheduledFilter === true}
                          onChange={(e) =>
                            onRescheduledFilterChange(e.target.checked ? true : undefined)
                          }
                          className="rounded text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                        />
                        <span>Show Rescheduled only</span>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        checked={!statusFilter}
                        onChange={() => onStatusFilterChange(undefined)}
                        className="text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                      />
                      <span>All Sent & Failed</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        checked={statusFilter === 'sent'}
                        onChange={() => onStatusFilterChange('sent')}
                        className="text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                      />
                      <span>Sent only</span>
                    </label>
                    <label className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        checked={statusFilter === 'failed'}
                        onChange={() => onStatusFilterChange('failed')}
                        className="text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                      />
                      <span>Failed only</span>
                    </label>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 text-gray-400 hover:text-ink hover:bg-gray-100 rounded-full transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh list"
          aria-label="Refresh list"
        >
          <RefreshIcon className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-ink' : ''}`} />
        </button>
      </div>
    </header>
  );
}
