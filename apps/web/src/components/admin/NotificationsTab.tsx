'use client';

import { cn } from '@feed/shared';
import { Bell, Send, User, UserPlus, Users } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { getAuthToken } from '@/lib/auth';
import { apiUrl } from '@/utils/api-url';

/**
 * Notification type for admin notifications tab.
 */
type NotificationType =
  | 'system'
  | 'comment'
  | 'reaction'
  | 'follow'
  | 'mention'
  | 'reply'
  | 'share';

/**
 * Recipient type for admin notifications tab.
 */
type RecipientType = 'specific' | 'all';

const AdminMutationResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

type MutationOutcome =
  | { ok: true; message: string | undefined }
  | { ok: false; message: string };

/**
 * POST an admin mutation and decode its result without throwing.
 * Network failures, non-JSON bodies, HTTP errors and `success: false`
 * envelopes are all surfaced as `{ ok: false }` with a readable message.
 */
async function postAdminMutation(
  path: string,
  body: Record<string, string | boolean | undefined>,
  fallbackError: string
): Promise<MutationOutcome> {
  const token = getAuthToken();
  if (!token) {
    return { ok: false, message: 'Not authenticated' };
  }

  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    payload = await response.json();
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : fallbackError,
    };
  }

  const parsed = AdminMutationResponseSchema.safeParse(payload);
  const data = parsed.success ? parsed.data : {};
  if (response.ok && data.success === true) {
    return { ok: true, message: data.message };
  }
  return {
    ok: false,
    message:
      data.error ??
      data.message ??
      `${fallbackError} (HTTP ${response.status})`,
  };
}

/**
 * Notifications tab component for sending admin notifications and NPC group
 * chat invites.
 *
 * @returns Notifications tab element
 */
export function NotificationsTab() {
  const [message, setMessage] = useState('');
  const [userId, setUserId] = useState('');
  const [type, setType] = useState<NotificationType>('system');
  const [recipientType, setRecipientType] = useState<RecipientType>('specific');
  const [isSending, setIsSending] = useState(false);

  const handleSend = useCallback(async () => {
    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    if (recipientType === 'specific' && !userId.trim()) {
      toast.error('Please enter a user ID');
      return;
    }

    if (isSending) return;
    setIsSending(true);
    const outcome = await postAdminMutation(
      '/api/admin/notifications',
      {
        message: message.trim(),
        type,
        ...(recipientType === 'specific'
          ? { userId: userId.trim() }
          : { sendToAll: true }),
      },
      'Failed to send notification'
    );
    setIsSending(false);

    if (outcome.ok) {
      toast.success(outcome.message ?? 'Notification sent successfully');
      setMessage('');
      setUserId('');
    } else {
      toast.error(outcome.message);
    }
  }, [isSending, message, userId, type, recipientType]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-xl">Send Notifications</h2>
      </div>

      {/* Form */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-6">
        {/* Recipient Type */}
        <div>
          <label className="mb-2 block font-medium text-sm">Recipient</label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isSending}
              onClick={() => setRecipientType('specific')}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors',
                recipientType === 'specific'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-muted'
              )}
            >
              <User className="h-4 w-4" />
              <span>Specific User</span>
            </button>
            <button
              type="button"
              disabled={isSending}
              onClick={() => setRecipientType('all')}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors',
                recipientType === 'all'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-muted'
              )}
            >
              <Users className="h-4 w-4" />
              <span>All Users</span>
            </button>
          </div>
        </div>

        {/* User ID (only for specific user) */}
        {recipientType === 'specific' && (
          <div>
            <label htmlFor="userId" className="mb-2 block font-medium text-sm">
              User ID
            </label>
            <input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter user ID (e.g., cm123abc...)"
              className={cn(
                'w-full rounded-lg border border-border px-4 py-2',
                'bg-background text-foreground',
                'focus:border-border focus:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
              disabled={isSending}
            />
            <p className="mt-1 text-muted-foreground text-xs">
              You can find user IDs in the Users tab or in the database
            </p>
          </div>
        )}

        {/* Notification Type */}
        <div>
          <label htmlFor="type" className="mb-2 block font-medium text-sm">
            Type
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as NotificationType)}
            className={cn(
              'w-full rounded-lg border border-border px-4 py-2',
              'bg-background text-foreground',
              'focus:border-border focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            disabled={isSending}
          >
            <option value="system">System</option>
            <option value="comment">Comment</option>
            <option value="reaction">Reaction</option>
            <option value="follow">Follow</option>
            <option value="mention">Mention</option>
            <option value="reply">Reply</option>
            <option value="share">Share</option>
          </select>
        </div>

        {/* Message */}
        <div>
          <label htmlFor="message" className="mb-2 block font-medium text-sm">
            Message
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter notification message..."
            rows={4}
            maxLength={500}
            className={cn(
              'w-full rounded-lg border border-border px-4 py-2',
              'bg-background text-foreground',
              'focus:border-border focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'resize-none'
            )}
            disabled={isSending}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            {message.length}/500 characters
          </p>
        </div>

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={
            isSending ||
            !message.trim() ||
            (recipientType === 'specific' && !userId.trim())
          }
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3',
            'bg-primary font-semibold text-primary-foreground',
            'transition-colors hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <Send className="h-4 w-4" />
          <span>{isSending ? 'Sending...' : 'Send Notification'}</span>
        </button>
      </div>

      {/* Warning */}
      {recipientType === 'all' && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">
            ⚠️ <strong>Warning:</strong> This will send the notification to all
            non-banned users. Make sure your message is appropriate for all
            users.
          </p>
        </div>
      )}

      {/* Info */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-4">
        <h3 className="font-semibold text-sm">Tips:</h3>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm">
          <li>Notifications appear in the user&apos;s notification feed</li>
          <li>System notifications are best for announcements and updates</li>
          <li>Keep messages concise and actionable (max 500 characters)</li>
          <li>
            Notifications won&apos;t be sent to banned users or NPCs/actors
          </li>
        </ul>
      </div>

      {/* Divider */}
      <div className="my-8 border-border border-t" />

      {/* Group Invite Section */}
      <GroupInviteSection />
    </div>
  );
}

// Group Invite Section Component
function GroupInviteSection() {
  const [npcId, setNpcId] = useState('');
  const [userId, setUserId] = useState('');
  const [chatId, setChatId] = useState('');
  const [sending, setSending] = useState(false);

  const handleSendInvite = useCallback(async () => {
    if (!npcId.trim()) {
      toast.error('Please enter an NPC ID');
      return;
    }

    if (!userId.trim()) {
      toast.error('Please enter a user ID');
      return;
    }

    if (sending) return;
    setSending(true);
    const outcome = await postAdminMutation(
      '/api/admin/group-invite',
      {
        npcId: npcId.trim(),
        userId: userId.trim(),
        chatId: chatId.trim() || undefined,
      },
      'Failed to add user to group'
    );
    setSending(false);

    if (outcome.ok) {
      toast.success(outcome.message ?? 'User added to group');
      setUserId('');
      setChatId('');
    } else {
      toast.error(outcome.message);
    }
  }, [sending, npcId, userId, chatId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-xl">Add User to NPC Group Chat</h2>
      </div>

      <p className="text-muted-foreground text-sm">
        Adds the user directly to an existing NPC-owned group chat (no
        acceptance step) and notifies them.
      </p>

      {/* Form */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-6">
        {/* NPC ID */}
        <div>
          <label htmlFor="npcId" className="mb-2 block font-medium text-sm">
            NPC ID (Inviter) *
          </label>
          <input
            id="npcId"
            type="text"
            value={npcId}
            onChange={(e) => setNpcId(e.target.value)}
            placeholder="Enter NPC/Actor ID (e.g., actor-1, demo-user-...)"
            className={cn(
              'w-full rounded-lg border border-border px-4 py-2',
              'bg-background text-foreground',
              'focus:border-primary focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            disabled={sending}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            The NPC that will send the invite. Check the Users tab or database
            for valid NPC IDs.
          </p>
        </div>

        {/* User ID */}
        <div>
          <label
            htmlFor="inviteUserId"
            className="mb-2 block font-medium text-sm"
          >
            User ID (Invitee) *
          </label>
          <input
            id="inviteUserId"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter user ID to invite"
            className={cn(
              'w-full rounded-lg border border-border px-4 py-2',
              'bg-background text-foreground',
              'focus:border-primary focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            disabled={sending}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            The user who will receive the invite. Find user IDs in the Users
            tab.
          </p>
        </div>

        {/* Chat ID (Optional) */}
        <div>
          <label htmlFor="chatId" className="mb-2 block font-medium text-sm">
            Chat ID (Optional)
          </label>
          <input
            id="chatId"
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Existing NPC group chat ID"
            className={cn(
              'w-full rounded-lg border border-border px-4 py-2',
              'bg-background text-foreground',
              'focus:border-primary focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            disabled={sending}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            Optional when the NPC owns exactly one group chat. Must be an
            existing group chat owned by the NPC.
          </p>
        </div>

        {/* Send Button */}
        <button
          onClick={handleSendInvite}
          disabled={sending || !npcId.trim() || !userId.trim()}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3',
            'bg-primary font-semibold text-primary-foreground',
            'transition-colors hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <UserPlus className="h-4 w-4" />
          <span>{sending ? 'Adding...' : 'Add to Group'}</span>
        </button>
      </div>

      {/* Info */}
      <div className="space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
        <h3 className="font-semibold text-blue-600 text-sm dark:text-blue-400">
          How it works:
        </h3>
        <ul className="list-inside list-disc space-y-1 text-blue-600 text-sm dark:text-blue-400">
          <li>The NPC will invite the user to their group chat</li>
          <li>A notification will be sent to the user</li>
          <li>The user will be added as a participant in the chat</li>
          <li>
            If the chat doesn&apos;t exist, it will be created automatically
          </li>
        </ul>
      </div>
    </div>
  );
}
