import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { ChevronDownIcon, ClockIcon, OnbLogo, SendIcon } from '../ui/Icons';

export type NavTab = 'scheduled' | 'sent';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenCompose: () => void;
  counts: { scheduled: number; sent: number };
  onCloseMobile?: () => void;
}

export function Sidebar({
  currentTab,
  onSelectTab,
  onOpenCompose,
  counts,
  onCloseMobile,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTabClick = (tab: NavTab) => {
    onSelectTab(tab);
    if (onCloseMobile) onCloseMobile();
  };

  const handleComposeClick = () => {
    onOpenCompose();
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <aside className="w-64 shrink-0 bg-white border-r border-line h-screen flex flex-col p-4 select-none">
      {/* Brand Header */}
      <div className="px-2 pt-1 pb-4">
        <OnbLogo />
      </div>

      {/* User Profile Card */}
      <div className="relative mb-4" ref={menuRef}>
        <button
          type="button"
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[var(--color-surface-muted)] transition-colors text-left cursor-pointer border border-transparent hover:border-gray-200"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar src={user?.avatarUrl} name={user?.name} email={user?.email} size="md" />
            <div className="min-w-0">
              <p className="text-13 font-semibold text-ink truncate leading-tight">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)] truncate leading-tight">
                {user?.email || 'user@domain.io'}
              </p>
            </div>
          </div>
          <ChevronDownIcon className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
        </button>

        {/* User Popup Dropdown */}
        {showUserMenu && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-line rounded-xl shadow-lg p-1.5 z-50">
            <div className="px-3 py-2 border-b border-line mb-1">
              <p className="text-xs text-ink-muted font-medium">Signed in as</p>
              <p className="text-xs font-semibold text-ink truncate">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Compose Button */}
      <div className="mb-6">
        <button
          type="button"
          onClick={handleComposeClick}
          className="w-full py-2.5 px-4 rounded-full border border-[var(--color-brand)] text-[var(--color-brand)] font-semibold text-sm hover:bg-[var(--color-brand-soft)] active:opacity-90 transition-all text-center cursor-pointer"
        >
          Compose
        </button>
      </div>

      {/* Navigation Section */}
      <div className="flex-1 flex flex-col">
        <div className="px-3 mb-2">
          <span className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
            Core
          </span>
        </div>

        <nav className="space-y-1">
          {/* Scheduled tab */}
          <button
            type="button"
            onClick={() => handleTabClick('scheduled')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-13 font-medium transition-colors cursor-pointer ${
              currentTab === 'scheduled'
                ? 'bg-[var(--color-brand-soft)] text-ink font-semibold'
                : 'text-ink hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            <div className="flex items-center gap-3">
              <ClockIcon
                className={`w-4 h-4 ${currentTab === 'scheduled' ? 'text-ink' : 'text-gray-500'}`}
              />
              <span>Scheduled</span>
            </div>
            <span
              className={`text-xs ${
                currentTab === 'scheduled' ? 'text-ink font-semibold' : 'text-gray-400 font-normal'
              }`}
            >
              {counts.scheduled}
            </span>
          </button>

          {/* Sent tab */}
          <button
            type="button"
            onClick={() => handleTabClick('sent')}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-13 font-medium transition-colors cursor-pointer ${
              currentTab === 'sent'
                ? 'bg-[var(--color-brand-soft)] text-ink font-semibold'
                : 'text-ink hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            <div className="flex items-center gap-3">
              <SendIcon
                className={`w-4 h-4 ${currentTab === 'sent' ? 'text-ink' : 'text-gray-500'}`}
              />
              <span>Sent</span>
            </div>
            <span
              className={`text-xs ${
                currentTab === 'sent' ? 'text-ink font-semibold' : 'text-gray-400 font-normal'
              }`}
            >
              {counts.sent}
            </span>
          </button>
        </nav>
      </div>
    </aside>
  );
}
