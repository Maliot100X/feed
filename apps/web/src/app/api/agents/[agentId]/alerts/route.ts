/**
 * Agent Price Alerts API
 *
 * @route GET /api/agents/[agentId]/alerts - List price alerts
 * @route POST /api/agents/[agentId]/alerts - Create/update a price alert
 * @route DELETE /api/agents/[agentId]/alerts - Remove a price alert
 * @access Authenticated (manager only)
 *
 * Manages price alerts stored in userAgentConfigs.priceAlerts JSONB column.
 * Alerts are checked every autonomous tick (~3 min) by PriceAlertService.
 */

import { authenticateUser, withErrorHandling } from '@feed/api';
import {
  and,
  chatParticipants,
  chats,
  db,
  eq,
  userAgentConfigs,
  users,
} from '@feed/db';
import type { PriceAlert } from '@feed/db/schema';
import { generateSnowflakeId } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const createAlertSchema = z.object({
  tokenSymbol: z.string().trim().min(1).max(20),
  condition: z.enum(['above', 'below']),
  threshold: z.number().positive(),
  deliveryChannel: z.enum(['team_chat', 'group']).optional(),
  deliveryChatId: z.string().trim().min(1).max(100).optional(),
  cooldownMinutes: z.number().int().positive().max(1440).optional(),
});

const deleteAlertSchema = z.union([
  z.object({ alertId: z.string().trim().min(1), tokenSymbol: z.undefined() }),
  z.object({
    alertId: z.undefined(),
    tokenSymbol: z.string().trim().min(1).max(20),
    condition: z.enum(['above', 'below']).optional(),
  }),
]);

/** Upper bound on stored alerts per agent (the tick checks every alert). */
const MAX_ALERTS_PER_AGENT = 50;

/**
 * A group delivery target must be an existing group chat in which the agent
 * is an active participant; otherwise alerts could post into arbitrary chats.
 */
async function isAgentGroupChat(
  agentId: string,
  chatId: string
): Promise<boolean> {
  const [membership] = await db
    .select({ chatId: chatParticipants.chatId })
    .from(chatParticipants)
    .innerJoin(chats, eq(chats.id, chatParticipants.chatId))
    .where(
      and(
        eq(chatParticipants.chatId, chatId),
        eq(chatParticipants.userId, agentId),
        eq(chatParticipants.isActive, true),
        eq(chats.isGroup, true)
      )
    )
    .limit(1);
  return Boolean(membership);
}

/** Read the alert list under a row lock so concurrent edits do not clobber each other. */
async function lockAlerts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  configId: string
): Promise<PriceAlert[]> {
  const [row] = await tx
    .select({ priceAlerts: userAgentConfigs.priceAlerts })
    .from(userAgentConfigs)
    .where(eq(userAgentConfigs.id, configId))
    .for('update');
  return (row?.priceAlerts ?? []) as PriceAlert[];
}

/**
 * Verify agent exists, is an agent, and is managed by the authenticated user.
 * Returns the agent's userAgentConfigs row or an error response.
 */
async function verifyAgentOwnership(
  req: NextRequest,
  agentId: string
): Promise<
  | { error: NextResponse }
  | { config: { id: string; priceAlerts: PriceAlert[] } }
> {
  const user = await authenticateUser(req);

  const [agent] = await db
    .select({
      id: users.id,
      isAgent: users.isAgent,
      managedBy: users.managedBy,
    })
    .from(users)
    .where(eq(users.id, agentId))
    .limit(1);

  if (!agent || !agent.isAgent) {
    return {
      error: NextResponse.json({ error: 'Agent not found' }, { status: 404 }),
    };
  }

  if (agent.managedBy !== user.id) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  const [config] = await db
    .select({
      id: userAgentConfigs.id,
      priceAlerts: userAgentConfigs.priceAlerts,
    })
    .from(userAgentConfigs)
    .where(eq(userAgentConfigs.userId, agentId))
    .limit(1);

  if (!config) {
    return {
      error: NextResponse.json(
        { error: 'Agent configuration not found' },
        { status: 404 }
      ),
    };
  }

  return {
    config: {
      id: config.id,
      priceAlerts: (config.priceAlerts ?? []) as PriceAlert[],
    },
  };
}

/**
 * GET - List all price alerts for an agent
 */
export const GET = withErrorHandling(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const result = await verifyAgentOwnership(req, agentId);

  if ('error' in result) return result.error;

  return NextResponse.json({
    success: true,
    alerts: result.config.priceAlerts,
  });
});

/**
 * POST - Create or update a price alert
 *
 * Body: { tokenSymbol, condition, threshold, deliveryChannel?, deliveryChatId?, cooldownMinutes? }
 *
 * If an alert for the same tokenSymbol+condition already exists, it is updated.
 */
export const POST = withErrorHandling(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const result = await verifyAgentOwnership(req, agentId);

  if ('error' in result) return result.error;

  const raw = await req.json();
  const parsed = createAlertSchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid input',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const {
    tokenSymbol,
    condition,
    threshold,
    deliveryChannel,
    deliveryChatId,
    cooldownMinutes,
  } = parsed.data;

  if (deliveryChannel === 'group' && !deliveryChatId) {
    return NextResponse.json(
      { error: 'deliveryChatId is required when deliveryChannel is "group"' },
      { status: 400 }
    );
  }

  if (deliveryChatId && deliveryChannel !== 'group') {
    return NextResponse.json(
      { error: 'deliveryChatId is only valid with deliveryChannel "group"' },
      { status: 400 }
    );
  }

  if (deliveryChatId && !(await isAgentGroupChat(agentId, deliveryChatId))) {
    return NextResponse.json(
      {
        error:
          'deliveryChatId must be a group chat the agent is an active member of',
      },
      { status: 400 }
    );
  }

  const upperSymbol = tokenSymbol.toUpperCase();
  const now = new Date().toISOString();
  const newId = await generateSnowflakeId();

  const outcome = await db.transaction(async (tx) => {
    const alerts = await lockAlerts(tx, result.config.id);

    // Check for existing alert with same token+condition
    const existingIdx = alerts.findIndex(
      (a) => a.tokenSymbol === upperSymbol && a.condition === condition
    );

    let alert: PriceAlert;
    if (existingIdx >= 0) {
      const existing = alerts[existingIdx]!;
      const channel = deliveryChannel ?? existing.deliveryChannel;
      alert = {
        ...existing,
        threshold,
        deliveryChannel: channel,
        // Switching to team_chat clears any stale group target.
        deliveryChatId:
          channel === 'group'
            ? (deliveryChatId ?? existing.deliveryChatId)
            : undefined,
        cooldownMinutes: cooldownMinutes ?? existing.cooldownMinutes,
        enabled: true,
        lastTriggeredAt: undefined, // Reset cooldown on update
      };
      if (alert.deliveryChannel === 'group' && !alert.deliveryChatId) {
        return {
          error: 'deliveryChatId is required when deliveryChannel is "group"',
        } as const;
      }
      alerts[existingIdx] = alert;
    } else {
      if (alerts.length >= MAX_ALERTS_PER_AGENT) {
        return {
          error: `An agent can have at most ${MAX_ALERTS_PER_AGENT} price alerts`,
        } as const;
      }
      alert = {
        id: newId,
        tokenSymbol: upperSymbol,
        condition,
        threshold,
        deliveryChannel: deliveryChannel ?? 'team_chat',
        deliveryChatId,
        enabled: true,
        cooldownMinutes: cooldownMinutes ?? 15,
        createdAt: now,
      };
      alerts.push(alert);
    }

    await tx
      .update(userAgentConfigs)
      .set({ priceAlerts: alerts, updatedAt: new Date() })
      .where(eq(userAgentConfigs.id, result.config.id));

    return { alert, updated: existingIdx >= 0 } as const;
  });

  if ('error' in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: 400 });
  }
  const { alert, updated } = outcome;

  return NextResponse.json(
    {
      success: true,
      alert,
      updated,
    },
    { status: updated ? 200 : 201 }
  );
});

/**
 * DELETE - Remove a price alert
 *
 * Query params: ?alertId=... OR ?tokenSymbol=...&condition=...
 */
export const DELETE = withErrorHandling(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const result = await verifyAgentOwnership(req, agentId);

  if ('error' in result) return result.error;

  const url = new URL(req.url);
  const selector = deleteAlertSchema.safeParse({
    alertId: url.searchParams.get('alertId') ?? undefined,
    tokenSymbol: url.searchParams.get('tokenSymbol') ?? undefined,
    condition: url.searchParams.get('condition') ?? undefined,
  });

  if (!selector.success) {
    return NextResponse.json(
      {
        error:
          'Provide exactly one of alertId or tokenSymbol (with optional condition "above"|"below")',
      },
      { status: 400 }
    );
  }
  const target = selector.data;

  const removed = await db.transaction(async (tx) => {
    const alerts = await lockAlerts(tx, result.config.id);

    const matches =
      target.alertId !== undefined
        ? alerts.filter((a) => a.id === target.alertId)
        : alerts.filter(
            (a) =>
              a.tokenSymbol === target.tokenSymbol.toUpperCase() &&
              (!target.condition || a.condition === target.condition)
          );
    // Without a condition, both directions may match; never guess which.
    if (matches.length > 1) return 'ambiguous' as const;
    const match = matches[0];
    if (!match) return undefined;

    await tx
      .update(userAgentConfigs)
      .set({
        priceAlerts: alerts.filter((a) => a.id !== match.id),
        updatedAt: new Date(),
      })
      .where(eq(userAgentConfigs.id, result.config.id));
    return match;
  });

  if (removed === 'ambiguous') {
    return NextResponse.json(
      {
        error:
          'Multiple alerts match this tokenSymbol; specify condition or alertId',
      },
      { status: 400 }
    );
  }

  if (!removed) {
    return NextResponse.json(
      { error: 'Price alert not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    removed,
  });
});
