import type {
  EmailCounts,
  EmailFolder,
  EmailStatus,
  EmailSummary,
  SlackConnectionStatus,
} from '@outbox/shared';
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { LoginPage } from './components/auth/LoginPage';
import { ComposeView } from './components/compose/ComposeView';
import { EmailDetailView } from './components/emails/EmailDetailView';
import { EmailList } from './components/emails/EmailList';
import { HeaderBar } from './components/layout/HeaderBar';
import { Sidebar, type NavTab } from './components/layout/Sidebar';
import { CheckIcon, Spinner, XIcon } from './components/ui/Icons';
import { AuthProvider, useAuth } from './context/AuthContext';

function parseCurrentPath(): {
  page: 'login' | 'dashboard' | 'compose' | 'detail';
  tab: NavTab;
  emailId?: string;
} {
  const pathname = window.location.pathname;
  if (pathname === '/login') {
    return { page: 'login', tab: 'scheduled' };
  }
  if (pathname.startsWith('/emails/')) {
    const id = pathname.replace('/emails/', '');
    return { page: 'detail', tab: 'scheduled', emailId: id };
  }
  if (pathname === '/compose') {
    return { page: 'compose', tab: 'scheduled' };
  }
  if (pathname === '/sent') {
    return { page: 'dashboard', tab: 'sent' };
  }
  return { page: 'dashboard', tab: 'scheduled' };
}

function MainApp() {
  const { user, isLoading: isAuthLoading } = useAuth();

  // Navigation State
  const [route, setRoute] = useState(parseCurrentPath());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Email counts for sidebar badges
  const [counts, setCounts] = useState<EmailCounts>({ scheduled: 0, sent: 0 });

  // Email list state
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmailStatus | undefined>(undefined);
  const [rescheduledFilter, setRescheduledFilter] = useState<boolean | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Slack state & toast feedback
  const [slackStatus, setSlackStatus] = useState<SlackConnectionStatus | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    const searchParams = new URLSearchParams(window.location.search);
    const slackParam = searchParams.get('slack');
    if (slackParam === 'connected') {
      return {
        type: 'success',
        message:
          'Slack connected successfully! Rate limit alerts will now be sent to your channel.',
      };
    }
    if (slackParam === 'error') {
      return {
        type: 'error',
        message: 'Slack connection failed or was cancelled.',
      };
    }
    return null;
  });

  // Clear slack query parameter from URL after reading initial toast state
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has('slack')) {
      searchParams.delete('slack');
      const newSearch = searchParams.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // Listen to browser Back/Forward
  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseCurrentPath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseCurrentPath());
  };

  // Fetch email counts
  const fetchCounts = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.getEmailCounts();
      setCounts(data);
    } catch (e) {
      console.error('Failed to fetch email counts:', e);
    }
  }, [user]);

  // Fetch Slack status
  const fetchSlackStatus = useCallback(async () => {
    if (!user || typeof api.getSlackStatus !== 'function') return;
    try {
      const status = await api.getSlackStatus();
      setSlackStatus(status);
    } catch {
      // Optional integration
    }
  }, [user]);

  // Handle initial data load
  useEffect(() => {
    if (!user) return;
    let ignore = false;

    api
      .getEmailCounts()
      .then((data) => {
        if (!ignore) setCounts(data);
      })
      .catch((e) => {
        console.error('Failed to fetch email counts:', e);
      });

    if (typeof api.getSlackStatus === 'function') {
      api
        .getSlackStatus()
        .then((status) => {
          if (!ignore) setSlackStatus(status);
        })
        .catch(() => {});
    }

    return () => {
      ignore = true;
    };
  }, [user]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Fetch emails for pagination (regular list mode)
  const loadMoreEmails = useCallback(
    async (folder: EmailFolder, cursor: string) => {
      if (!user || searchQuery.trim()) return;
      try {
        setIsLoadingMore(true);
        const res = await api.listEmails({
          folder,
          status: statusFilter,
          rescheduled: rescheduledFilter,
          cursor,
          limit: 25,
        });
        setEmails((prev) => [...prev, ...res.items]);
        setNextCursor(res.nextCursor);
      } catch (err) {
        console.error('Failed to load more emails:', err);
      } finally {
        setIsLoadingMore(false);
      }
    },
    [user, searchQuery, statusFilter, rescheduledFilter],
  );

  // Fetch emails or search results when tab, filters, or search query change
  useEffect(() => {
    if (!user || route.page !== 'dashboard') return;
    let ignore = false;
    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery.length > 0) {
      const debounceTimer = setTimeout(() => {
        setIsLoadingEmails(true);
        api
          .searchEmails({
            q: trimmedQuery,
            folder: route.tab,
            status: statusFilter,
            limit: 50,
          })
          .then((res) => {
            if (!ignore) {
              setEmails(res.items);
              setNextCursor(null);
              setEmailError(null);
              setIsLoadingEmails(false);
            }
          })
          .catch((err) => {
            if (!ignore) {
              setEmailError(
                err?.code === 'SEARCH_UNAVAILABLE'
                  ? 'Search is currently unavailable'
                  : err instanceof Error
                    ? err.message
                    : 'Failed to search emails',
              );
              setIsLoadingEmails(false);
            }
          });
      }, 250);

      return () => {
        ignore = true;
        clearTimeout(debounceTimer);
      };
    }

    api
      .listEmails({
        folder: route.tab,
        status: statusFilter,
        rescheduled: rescheduledFilter,
        limit: 25,
      })
      .then((res) => {
        if (!ignore) {
          setEmails(res.items);
          setNextCursor(res.nextCursor);
          setEmailError(null);
          setIsLoadingEmails(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setEmailError(err instanceof Error ? err.message : 'Failed to load emails');
          setIsLoadingEmails(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [user, route.page, route.tab, searchQuery, statusFilter, rescheduledFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const trimmedQuery = searchQuery.trim();
      if (trimmedQuery.length > 0) {
        const [newCounts, res] = await Promise.all([
          api.getEmailCounts(),
          api.searchEmails({
            q: trimmedQuery,
            folder: route.tab,
            status: statusFilter,
            limit: 50,
          }),
        ]);
        setCounts(newCounts);
        setEmails(res.items);
        setNextCursor(null);
        setEmailError(null);
      } else {
        const [newCounts, res] = await Promise.all([
          api.getEmailCounts(),
          api.listEmails({
            folder: route.tab,
            status: statusFilter,
            rescheduled: rescheduledFilter,
            limit: 25,
          }),
        ]);
        setCounts(newCounts);
        setEmails(res.items);
        setNextCursor(res.nextCursor);
        setEmailError(null);
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTabSelect = (tab: NavTab) => {
    setStatusFilter(undefined);
    setRescheduledFilter(undefined);
    setSearchQuery('');
    navigateTo(tab === 'scheduled' ? '/' : `/${tab}`);
  };

  const handleLoadMore = () => {
    if (nextCursor && !isLoadingMore) {
      loadMoreEmails(route.tab, nextCursor);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white">
        <Spinner className="w-8 h-8 text-[var(--color-brand)] mb-3" />
        <p className="text-sm font-medium text-[var(--color-ink-muted)]">Loading OutBox...</p>
      </div>
    );
  }

  // Not authenticated: render Login page
  if (!user || route.page === 'login') {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-ink relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200 bg-white border-line">
          {toast.type === 'success' ? (
            <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <CheckIcon className="w-3 h-3" />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0">
              <XIcon className="w-3 h-3" />
            </div>
          )}
          <span className="text-ink font-medium max-w-sm">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-gray-400 hover:text-ink ml-1 cursor-pointer p-0.5"
            aria-label="Close"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          currentTab={route.tab}
          onSelectTab={handleTabSelect}
          onOpenCompose={() => navigateTo('/compose')}
          counts={counts}
          slackStatus={slackStatus}
          onRefreshSlack={fetchSlackStatus}
        />
      </div>

      {/* Mobile Sidebar Overlay / Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <div className="relative z-10">
            <Sidebar
              currentTab={route.tab}
              onSelectTab={handleTabSelect}
              onOpenCompose={() => navigateTo('/compose')}
              counts={counts}
              slackStatus={slackStatus}
              onRefreshSlack={fetchSlackStatus}
              onCloseMobile={() => setMobileSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {route.page === 'compose' ? (
          <ComposeView
            onClose={() => navigateTo(route.tab === 'scheduled' ? '/' : `/${route.tab}`)}
            onSuccess={() => {
              fetchCounts();
              navigateTo('/');
            }}
          />
        ) : route.page === 'detail' && route.emailId ? (
          <EmailDetailView
            emailId={route.emailId}
            onBack={() => navigateTo(route.tab === 'scheduled' ? '/' : `/${route.tab}`)}
          />
        ) : (
          <>
            <HeaderBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              currentTab={route.tab}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              rescheduledFilter={rescheduledFilter}
              onRescheduledFilterChange={setRescheduledFilter}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
              onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            />

            <main className="flex-1 overflow-y-auto flex flex-col bg-white">
              <EmailList
                emails={emails}
                folder={route.tab}
                isLoading={isLoadingEmails}
                isLoadingMore={isLoadingMore}
                error={emailError}
                searchQuery={searchQuery}
                hasMore={Boolean(nextCursor)}
                onLoadMore={handleLoadMore}
                onSelectEmail={(id) => navigateTo(`/emails/${id}`)}
                onRetry={handleRefresh}
              />
            </main>
          </>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
export default App;
