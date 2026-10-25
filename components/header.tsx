'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ClipboardList, KeyRound, LogOut, MoreVertical, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AuthenticatedUser } from '@/lib/auth';
import { ROLE_DETAILS } from '@/lib/roles';

type SystemHealth = 'checking' | 'online' | 'offline' | 'unavailable';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>('checking');

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        if (!response.ok) throw new Error('Unable to verify the signed-in user.');
        return (await response.json()) as { user: AuthenticatedUser };
      })
      .then((result) => {
        if (result) setUser(result.user);
      })
      .catch((error: unknown) => {
        console.error('Failed to load the signed-in user:', error);
      });
  }, [router]);

  useEffect(() => {
    let disposed = false;
    let activeController: AbortController | undefined;
    let timeoutId: number | undefined;

    const checkHealth = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestTimeoutId = window.setTimeout(() => controller.abort(), 8000);
      timeoutId = requestTimeoutId;

      try {
        const response = await fetch('/api/health', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const result = (await response.json()) as { status?: string };
        if (!disposed && activeController === controller) {
          setSystemHealth(response.ok && result.status === 'ok' ? 'online' : 'unavailable');
        }
      } catch {
        if (!disposed && activeController === controller) {
          setSystemHealth(navigator.onLine ? 'unavailable' : 'offline');
        }
      } finally {
        window.clearTimeout(requestTimeoutId);
        if (activeController === controller) {
          activeController = undefined;
          timeoutId = undefined;
        }
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void checkHealth();
    };
    const handleOffline = () => {
      activeController?.abort();
      setSystemHealth('offline');
    };
    const handleOnline = () => void checkHealth();

    void checkHealth();
    const intervalId = window.setInterval(checkWhenVisible, 30_000);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', checkWhenVisible);

    return () => {
      disposed = true;
      activeController?.abort();
      window.clearInterval(intervalId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, []);

  const signOut = async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) {
      console.error('Failed to sign out:', await response.text());
      return;
    }
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-20 items-center justify-between gap-3 py-2">
          <Link
            href="/"
            aria-label="Go to the main page and asset register"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Image
              src="/health-logo.avif"
              alt="Gauteng Department of Health logo"
              width={160}
              height={64}
              priority
              className="h-12 w-[120px] shrink-0 object-cover sm:h-16 sm:w-40"
            />
            <div>
              <h1 className="text-base font-bold leading-tight text-foreground sm:text-lg">
                Gauteng Health Assets Control
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Department of Health — Asset Management System
              </p>
              <p className="hidden text-xs font-medium leading-tight text-primary sm:block">
                Protecting public assets through accountable stewardship.
              </p>
            </div>
          </Link>
          <div
            className="flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            role="status"
            aria-live="polite"
            title={
              systemHealth === 'online'
                ? 'Database connection is working.'
                : systemHealth === 'offline'
                  ? 'This device is offline.'
                  : systemHealth === 'unavailable'
                    ? 'The app could not reach the database.'
                    : 'Checking the database connection.'
            }
          >
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                systemHealth === 'online'
                  ? 'bg-success'
                  : systemHealth === 'checking'
                    ? 'animate-pulse bg-muted-foreground'
                    : 'bg-destructive'
              }`}
            />
            {systemHealth === 'online'
              ? 'System Live'
              : systemHealth === 'offline'
                ? 'Network Offline'
                : systemHealth === 'unavailable'
                  ? 'System Unavailable'
                  : 'Checking System'}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border py-2">
          {user && (
            <div className="min-w-0 text-right">
              <p className="text-xs font-semibold text-foreground">
                {[user.display_name, user.surname].filter(Boolean).join(' ')}
              </p>
              <p className="text-[10px] capitalize text-muted-foreground">
                {ROLE_DETAILS[user.role].label}
                {user.role !== 'super_administrator' && user.district
                  ? ` · ${user.district}`
                  : ''}
              </p>
            </div>
          )}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Open navigation menu"
                  title="Navigation and account options"
                >
                  <MoreVertical className="h-5 w-5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Navigate</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
                    <LayoutDashboard className="mr-2 h-4 w-4" aria-hidden="true" />
                    Dashboard / Asset register
                  </Link>
                </DropdownMenuItem>
                {user.role === 'super_administrator' && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href="/users" aria-current={pathname === '/users' ? 'page' : undefined}>
                        <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                        User management
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/audit" aria-current={pathname === '/audit' ? 'page' : undefined}>
                        <ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />
                        Audit history
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/account/profile" aria-current={pathname === '/account/profile' ? 'page' : undefined}>
                    <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
                    My profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/account/password" aria-current={pathname === '/account/password' ? 'page' : undefined}>
                    <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                    Password
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
