/**
 * Moderation Settings Page
 *
 * Manage blocked and muted users
 */

'use client';

export const dynamic = 'force-dynamic';

import { cn, formatDate } from '@feed/shared';
import type { LucideIcon } from 'lucide-react';
import { Ban, Trash2, UserX, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/shared/Avatar';
import { PageContainer } from '@/components/shared/PageContainer';
import { Skeleton } from '@/components/shared/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/utils/api-fetch';

interface ModeratedUser {
  id: string;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
}

interface ModerationEntry {
  id: string;
  createdAt: string;
  reason: string | null;
  user: ModeratedUser;
}

type Tab = 'blocked' | 'muted';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: ModerationEntry[] };

const LISTS: Record<
  Tab,
  {
    endpoint: string;
    responseKey: 'blocks' | 'mutes';
    userKey: 'blocked' | 'muted';
    action: 'unblock' | 'unmute';
    actionPath: 'block' | 'mute';
    label: string;
    actionLabel: string;
    pastTense: string;
    emptyTitle: string;
    emptyHint: string;
    tabIcon: LucideIcon;
    emptyIcon: LucideIcon;
  }
> = {
  blocked: {
    endpoint: '/api/moderation/blocks',
    responseKey: 'blocks',
    userKey: 'blocked',
    action: 'unblock',
    actionPath: 'block',
    label: 'Blocked',
    actionLabel: 'Unblock',
    pastTense: 'Blocked',
    emptyTitle: 'No blocked users',
    emptyHint: 'Users you block will appear here',
    tabIcon: Ban,
    emptyIcon: UserX,
  },
  muted: {
    endpoint: '/api/moderation/mutes',
    responseKey: 'mutes',
    userKey: 'muted',
    action: 'unmute',
    actionPath: 'mute',
    label: 'Muted',
    actionLabel: 'Unmute',
    pastTense: 'Muted',
    emptyTitle: 'No muted users',
    emptyHint: 'Users you mute will appear here',
    tabIcon: VolumeX,
    emptyIcon: VolumeX,
  },
};

type RawEntry = {
  id: string;
  createdAt: string;
  reason: string | null;
  blocked?: ModeratedUser;
  muted?: ModeratedUser;
};

export default function ModerationSettingsPage() {
  const { authenticated, user } = useAuth();
  const ownerId = authenticated ? (user?.id ?? null) : null;
  const [activeTab, setActiveTab] = useState<Tab>('blocked');
  const [lists, setLists] = useState<Record<Tab, ListState>>({
    blocked: { status: 'loading' },
    muted: { status: 'loading' },
  });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  // Responses for a previous account must not land in the current one.
  const ownerRef = useRef(ownerId);
  ownerRef.current = ownerId;

  const loadList = useCallback(async (tab: Tab, owner: string) => {
    const config = LISTS[tab];
    const result = await apiFetch(config.endpoint)
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as Record<
          string,
          RawEntry[] | undefined
        >;
        return (data[config.responseKey] ?? []).flatMap((entry) => {
          const target = entry[config.userKey];
          return target
            ? [
                {
                  id: entry.id,
                  createdAt: entry.createdAt,
                  reason: entry.reason,
                  user: target,
                },
              ]
            : [];
        });
      })
      .catch(() => null);

    if (ownerRef.current !== owner) return;
    if (result === null) {
      toast.error(`Failed to load ${config.label.toLowerCase()} users`);
      setLists((prev) => ({ ...prev, [tab]: { status: 'error' } }));
      return;
    }
    setLists((prev) => ({
      ...prev,
      [tab]: { status: 'ready', entries: result },
    }));
  }, []);

  useEffect(() => {
    setLists({ blocked: { status: 'loading' }, muted: { status: 'loading' } });
    setPendingIds(new Set());
    pendingRef.current = new Set();
    if (!ownerId) return;
    void loadList('blocked', ownerId);
    void loadList('muted', ownerId);
  }, [ownerId, loadList]);

  const handleRemove = async (tab: Tab, targetUserId: string) => {
    if (!ownerId || pendingRef.current.has(targetUserId)) return;
    const config = LISTS[tab];
    pendingRef.current.add(targetUserId);
    setPendingIds(new Set(pendingRef.current));

    const ok = await apiFetch(
      `/api/users/${encodeURIComponent(targetUserId)}/${config.actionPath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: config.action }),
      }
    )
      .then((response) => response.ok)
      .catch(() => false);

    if (ownerRef.current !== ownerId) return;
    if (ok) {
      await loadList(tab, ownerId);
    } else {
      toast.error(`Failed to ${config.action} user`);
    }
    pendingRef.current.delete(targetUserId);
    setPendingIds(new Set(pendingRef.current));
  };

  if (!authenticated) {
    return (
      <PageContainer className="pt-14 md:pt-0">
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            Please log in to view moderation settings.
          </p>
        </div>
      </PageContainer>
    );
  }

  const activeConfig = LISTS[activeTab];
  const activeList = lists[activeTab];
  const EmptyIcon = activeConfig.emptyIcon;

  return (
    <PageContainer className="pt-14 md:pt-0">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-2 font-bold text-3xl">Moderation Settings</h1>
          <p className="text-muted-foreground">
            Manage your blocked and muted users
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 border-border border-b">
          {(Object.keys(LISTS) as Tab[]).map((tab) => {
            const config = LISTS[tab];
            const list = lists[tab];
            const TabIcon = config.tabIcon;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  '-mb-[1px] flex items-center gap-2 border-b-2 px-4 py-2 font-medium transition-colors',
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <TabIcon className="h-4 w-4" />
                {config.label}
                {list.status === 'ready' ? ` (${list.entries.length})` : ''}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {activeList.status === 'loading' ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : activeList.status === 'error' ? (
          <div className="rounded-lg border border-border bg-card py-12 text-center">
            <p className="text-muted-foreground">
              Couldn&apos;t load {activeConfig.label.toLowerCase()} users.
            </p>
            <button
              type="button"
              onClick={() => {
                if (!ownerId) return;
                setLists((prev) => ({
                  ...prev,
                  [activeTab]: { status: 'loading' },
                }));
                void loadList(activeTab, ownerId);
              }}
              className="mt-3 rounded-lg bg-muted px-4 py-2 transition-colors hover:bg-muted/80"
            >
              Try again
            </button>
          </div>
        ) : activeList.entries.length === 0 ? (
          <div className="rounded-lg border border-border bg-card py-12 text-center">
            <EmptyIcon className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">{activeConfig.emptyTitle}</p>
            <p className="mt-1 text-muted-foreground text-sm">
              {activeConfig.emptyHint}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeList.entries.map((entry) => {
              const target = entry.user;
              const displayName =
                target.displayName || target.username || 'User';
              const pending = pendingIds.has(target.id);

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
                >
                  <Avatar
                    src={target.profileImageUrl || undefined}
                    alt={displayName}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{displayName}</div>
                    {target.username && (
                      <div className="text-muted-foreground text-sm">
                        @{target.username}
                      </div>
                    )}
                    {entry.reason && (
                      <div className="mt-1 text-muted-foreground text-xs">
                        Reason: {entry.reason}
                      </div>
                    )}
                    <div className="mt-1 text-muted-foreground text-xs">
                      {activeConfig.pastTense} {formatDate(entry.createdAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleRemove(activeTab, target.id)}
                    disabled={pending}
                    className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 transition-colors hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {activeConfig.actionLabel}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
