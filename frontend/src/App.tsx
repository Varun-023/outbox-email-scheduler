import type { EmailCounts, EmailFolder, EmailStatus, EmailSummary } from '@outbox/shared';
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { LoginPage } from './components/auth/LoginPage';
import { ComposeView } from './components/compose/ComposeView';
import { EmailDetailView } from './components/emails/EmailDetailView';
import { EmailList } from './components/emails/EmailList';
import { HeaderBar } from './components/layout/HeaderBar';
import { Sidebar, type NavTab } from './components/layout/Sidebar';
import { Spinner } from './components/ui/Icons';
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

  // Fetch emails for pagination
  const loadMoreEmails = useCallback(
    async (folder: EmailFolder, cursor: string) => {
      if (!user) return;
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
    [user, statusFilter, rescheduledFilter],
  );

  // Refresh counts on user login
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
    return () => {
      ignore = true;
    };
  }, [user]);

  // Fetch emails when tab or filters change
  useEffect(() => {
    if (!user || route.page !== 'dashboard') return;
    let ignore = false;
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
  }, [user, route.page, route.tab, statusFilter, rescheduledFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
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
    <div className="flex h-screen w-screen overflow-hidden bg-white text-ink">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          currentTab={route.tab}
          onSelectTab={handleTabSelect}
          onOpenCompose={() => navigateTo('/compose')}
          counts={counts}
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
