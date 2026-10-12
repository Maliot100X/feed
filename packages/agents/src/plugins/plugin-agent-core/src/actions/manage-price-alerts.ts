/**
 * Manage Price Alerts Actions
 *
 * Three actions for managing price alerts on perpetual markets:
 * - SET_PRICE_ALERT: Create or update a price alert
 * - LIST_PRICE_ALERTS: Show all configured price alerts
 * - REMOVE_PRICE_ALERT: Delete a specific price alert
 *
 * Alerts are stored as JSONB in userAgentConfigs.priceAlerts and checked
 * every autonomous tick (~3 minutes) by PriceAlertService.
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { and, chatParticipants, db, eq, sql, userAgentConfigs } from '@feed/db';
import type { PriceAlert } from '@feed/db/schema';
import { logger } from '../../../../shared/logger';
import { generateSnowflakeId } from '../../../../shared/snowflake';

// ─── Shared helpers ─────────────────────────────────────────────────────

const MIN_COOLDOWN_MINUTES = 1;
const MAX_COOLDOWN_MINUTES = 7 * 24 * 60;
const TOKEN_SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;

function normalizeSymbol(symbol: unknown): string | null {
  if (typeof symbol !== 'string') return null;
  const upper = symbol.trim().toUpperCase();
  return TOKEN_SYMBOL_PATTERN.test(upper) ? upper : null;
}

/**
 * Compare-and-set the alerts array: only writes if the stored JSONB still
 * equals what we read, so concurrent alert mutations (or PriceAlertService
 * trigger timestamp updates) are not silently overwritten.
 * @returns false when the row changed since it was read
 */
async function writeAlertsIfUnchanged(
  configId: string,
  previous: PriceAlert[] | null,
  next: PriceAlert[]
): Promise<boolean> {
  const previousJson = previous === null ? null : JSON.stringify(previous);
  const updated = await db
    .update(userAgentConfigs)
    .set({ priceAlerts: next, updatedAt: new Date() })
    .where(
      and(
        eq(userAgentConfigs.id, configId),
        sql`${userAgentConfigs.priceAlerts} IS NOT DISTINCT FROM ${previousJson}::jsonb`
      )
    )
    .returning({ id: userAgentConfigs.id });
  return updated.length > 0;
}

const CONCURRENT_UPDATE_RESULT: ActionResult = {
  success: false,
  text: 'Price alerts changed while updating. Please retry.',
  error: 'Concurrent update',
};

// ─── SET_PRICE_ALERT ────────────────────────────────────────────────────

interface SetPriceAlertParams {
  tokenSymbol: string;
  condition: 'below' | 'above';
  threshold: number;
  deliveryChannel?: 'team_chat' | 'group';
  deliveryChatId?: string;
  cooldownMinutes?: number;
}

export const setPriceAlertAction: Action = {
  name: 'SET_PRICE_ALERT',
  description:
    'Set a price alert on a perpetual market token. You will be notified when the price crosses the threshold. Delivery goes to your team chat by default, or a specific group chat.',

  parameters: {
    tokenSymbol: {
      type: 'string',
      description:
        'Token ticker symbol matching perpMarketSnapshots (e.g., "OPENAGI", "TSLAI")',
      required: true,
    },
    condition: {
      type: 'string',
      description: '"above" or "below" — the direction to trigger on',
      required: true,
    },
    threshold: {
      type: 'number',
      description: 'Price threshold to trigger the alert',
      required: true,
    },
    deliveryChannel: {
      type: 'string',
      description:
        '"team_chat" (default) or "group" — where to deliver the alert',
      required: false,
    },
    deliveryChatId: {
      type: 'string',
      description: 'Group chat ID — required when deliveryChannel is "group"',
      required: false,
    },
    cooldownMinutes: {
      type: 'number',
      description:
        'Minutes between re-triggers (default 15). Prevents alert spam.',
      required: false,
    },
  } as unknown as Action['parameters'],

  examples: [
    [
      {
        name: 'User',
        content: {
          text: 'Alert me when OPENAGI drops below $0.50',
        },
      },
      {
        name: 'Agent',
        content: {
          text: 'I have set a price alert for OPENAGI below $0.50. You will be notified in team chat when it triggers.',
          action: 'SET_PRICE_ALERT',
        },
      },
    ],
    [
      {
        name: 'User',
        content: {
          text: 'Set an alert for TSLAI above $2.00 with 30 minute cooldown',
        },
      },
      {
        name: 'Agent',
        content: {
          text: 'Price alert set: TSLAI above $2.00 with 30-minute cooldown between notifications.',
          action: 'SET_PRICE_ALERT',
        },
      },
    ],
  ],

  validate: async (): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const agentUserId = _runtime.agentId;
    const params = state?.data?.actionParams as SetPriceAlertParams | undefined;

    if (!params) {
      return {
        success: false,
        text: 'Missing parameters: tokenSymbol, condition, threshold required.',
        error: 'Missing parameters',
      };
    }

    const {
      tokenSymbol,
      condition,
      threshold,
      deliveryChannel,
      deliveryChatId,
      cooldownMinutes,
    } = params;

    if (!tokenSymbol || !condition || threshold == null) {
      return {
        success: false,
        text: 'Missing required parameters: tokenSymbol, condition, threshold.',
        error: 'Missing required parameters',
      };
    }

    const symbol = normalizeSymbol(tokenSymbol);
    if (!symbol) {
      return {
        success: false,
        text: 'tokenSymbol must be an alphanumeric market ticker (e.g. "OPENAGI").',
        error: 'Invalid tokenSymbol',
      };
    }

    if (condition !== 'above' && condition !== 'below') {
      return {
        success: false,
        text: 'Condition must be "above" or "below".',
        error: 'Invalid condition',
      };
    }

    if (
      typeof threshold !== 'number' ||
      !Number.isFinite(threshold) ||
      threshold <= 0
    ) {
      return {
        success: false,
        text: 'Threshold must be a positive number.',
        error: 'Invalid threshold',
      };
    }

    if (
      cooldownMinutes !== undefined &&
      (typeof cooldownMinutes !== 'number' ||
        !Number.isInteger(cooldownMinutes) ||
        cooldownMinutes < MIN_COOLDOWN_MINUTES ||
        cooldownMinutes > MAX_COOLDOWN_MINUTES)
    ) {
      return {
        success: false,
        text: `cooldownMinutes must be an integer between ${MIN_COOLDOWN_MINUTES} and ${MAX_COOLDOWN_MINUTES}.`,
        error: 'Invalid cooldownMinutes',
      };
    }

    if (
      deliveryChannel !== undefined &&
      deliveryChannel !== 'team_chat' &&
      deliveryChannel !== 'group'
    ) {
      return {
        success: false,
        text: 'deliveryChannel must be "team_chat" or "group".',
        error: 'Invalid deliveryChannel',
      };
    }

    if (deliveryChannel === 'group' && !deliveryChatId) {
      return {
        success: false,
        text: 'deliveryChatId is required when deliveryChannel is "group".',
        error: 'Missing deliveryChatId',
      };
    }

    // Group delivery is only allowed to chats the agent actively belongs to.
    if (deliveryChannel === 'group' && deliveryChatId) {
      const [membership] = await db
        .select({ id: chatParticipants.id })
        .from(chatParticipants)
        .where(
          and(
            eq(chatParticipants.chatId, deliveryChatId),
            eq(chatParticipants.userId, agentUserId),
            eq(chatParticipants.isActive, true)
          )
        )
        .limit(1);
      if (!membership) {
        return {
          success: false,
          text: 'You can only deliver alerts to group chats you are a member of.',
          error: 'Not a member of delivery chat',
        };
      }
    }

    // Fetch current config
    const [config] = await db
      .select({
        id: userAgentConfigs.id,
        priceAlerts: userAgentConfigs.priceAlerts,
      })
      .from(userAgentConfigs)
      .where(eq(userAgentConfigs.userId, agentUserId))
      .limit(1);

    if (!config) {
      return {
        success: false,
        text: 'Agent configuration not found. Ensure agent is properly set up.',
        error: 'Config not found',
      };
    }

    const storedAlerts = config.priceAlerts as PriceAlert[] | null;
    const alerts = storedAlerts ?? [];

    // Check for duplicate (same token + condition)
    const existing = alerts.find(
      (a) => a.tokenSymbol === symbol && a.condition === condition
    );

    const now = new Date().toISOString();
    let newAlert: PriceAlert;

    if (existing) {
      // Update existing alert
      const nextChannel = deliveryChannel ?? existing.deliveryChannel;
      newAlert = {
        ...existing,
        threshold,
        deliveryChannel: nextChannel,
        // Switching back to team chat drops the stale group target
        deliveryChatId:
          nextChannel === 'group'
            ? (deliveryChatId ?? existing.deliveryChatId)
            : undefined,
        cooldownMinutes: cooldownMinutes ?? existing.cooldownMinutes,
        enabled: true,
        // A new threshold is a new alert condition: reset the cooldown.
        // Otherwise keep the last trigger so re-saving does not re-fire.
        lastTriggeredAt:
          threshold !== existing.threshold
            ? undefined
            : existing.lastTriggeredAt,
      };
      const updatedAlerts = alerts.map((a) =>
        a.id === existing.id ? newAlert : a
      );

      if (
        !(await writeAlertsIfUnchanged(config.id, storedAlerts, updatedAlerts))
      ) {
        return CONCURRENT_UPDATE_RESULT;
      }

      logger.info(
        `[SET_PRICE_ALERT] Updated alert: ${tokenSymbol} ${condition} ${threshold}`,
        { agentUserId, alertId: existing.id },
        'ManagePriceAlerts'
      );

      return {
        success: true,
        text: `Updated price alert: ${symbol} ${condition} $${threshold}. Delivery: ${newAlert.deliveryChannel}. Cooldown: ${newAlert.cooldownMinutes} min.`,
        data: { alertId: existing.id, updated: true },
      };
    }

    // Create new alert
    const alertId = await generateSnowflakeId();
    newAlert = {
      id: alertId,
      tokenSymbol: symbol,
      condition,
      threshold,
      deliveryChannel: deliveryChannel ?? 'team_chat',
      deliveryChatId: deliveryChannel === 'group' ? deliveryChatId : undefined,
      enabled: true,
      cooldownMinutes: cooldownMinutes ?? 15,
      createdAt: now,
    };

    const updatedAlerts = [...alerts, newAlert];
    if (
      !(await writeAlertsIfUnchanged(config.id, storedAlerts, updatedAlerts))
    ) {
      return CONCURRENT_UPDATE_RESULT;
    }

    logger.info(
      `[SET_PRICE_ALERT] Created alert: ${tokenSymbol} ${condition} ${threshold}`,
      { agentUserId, alertId },
      'ManagePriceAlerts'
    );

    return {
      success: true,
      text: `Price alert set: ${symbol} ${condition} $${threshold}. Delivery: ${newAlert.deliveryChannel}. Cooldown: ${newAlert.cooldownMinutes} min.`,
      data: { alertId, created: true },
    };
  },
};

// ─── LIST_PRICE_ALERTS ──────────────────────────────────────────────────

export const listPriceAlertsAction: Action = {
  name: 'LIST_PRICE_ALERTS',
  description:
    'List all configured price alerts with their current status, thresholds, and delivery settings.',

  parameters: [] as Action['parameters'],

  examples: [
    [
      {
        name: 'User',
        content: {
          text: 'Show my price alerts',
        },
      },
      {
        name: 'Agent',
        content: {
          text: 'Here are your active price alerts:\n1. OPENAGI below $0.50 (team_chat, 15min cooldown)\n2. TSLAI above $2.00 (team_chat, 30min cooldown)',
          action: 'LIST_PRICE_ALERTS',
        },
      },
    ],
  ],

  validate: async (): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const agentUserId = _runtime.agentId;

    const [config] = await db
      .select({ priceAlerts: userAgentConfigs.priceAlerts })
      .from(userAgentConfigs)
      .where(eq(userAgentConfigs.userId, agentUserId))
      .limit(1);

    const alerts = (config?.priceAlerts ?? []) as PriceAlert[];

    if (alerts.length === 0) {
      return {
        success: true,
        text: 'No price alerts configured. Use SET_PRICE_ALERT to create one.',
        data: { alerts: [] },
      };
    }

    const lines = alerts.map((a, i) => {
      const status = a.enabled ? '✓' : '✗';
      const lastTriggered = a.lastTriggeredAt
        ? ` (last triggered: ${new Date(a.lastTriggeredAt).toLocaleString()})`
        : '';
      return `${i + 1}. [${status}] ${a.tokenSymbol} ${a.condition} $${a.threshold} → ${a.deliveryChannel}, ${a.cooldownMinutes}min cooldown${lastTriggered} (id: ${a.id})`;
    });

    return {
      success: true,
      text: `Price alerts (${alerts.length}):\n${lines.join('\n')}`,
      data: { alerts },
    };
  },
};

// ─── REMOVE_PRICE_ALERT ─────────────────────────────────────────────────

interface RemovePriceAlertParams {
  alertId?: string;
  tokenSymbol?: string;
  condition?: 'below' | 'above';
}

export const removePriceAlertAction: Action = {
  name: 'REMOVE_PRICE_ALERT',
  description:
    'Remove a price alert by its ID, or by token symbol and condition.',

  parameters: {
    alertId: {
      type: 'string',
      description: 'The alert ID to remove (from LIST_PRICE_ALERTS)',
      required: false,
    },
    tokenSymbol: {
      type: 'string',
      description:
        'Token symbol to match (used with condition when alertId not provided)',
      required: false,
    },
    condition: {
      type: 'string',
      description:
        '"above" or "below" — used with tokenSymbol when alertId not provided',
      required: false,
    },
  } as unknown as Action['parameters'],

  examples: [
    [
      {
        name: 'User',
        content: {
          text: 'Remove my OPENAGI price alert',
        },
      },
      {
        name: 'Agent',
        content: {
          text: 'Removed price alert for OPENAGI below $0.50.',
          action: 'REMOVE_PRICE_ALERT',
        },
      },
    ],
  ],

  validate: async (): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const agentUserId = _runtime.agentId;
    const params = state?.data?.actionParams as
      | RemovePriceAlertParams
      | undefined;

    if (!params) {
      return {
        success: false,
        text: 'Missing parameters: provide alertId or tokenSymbol+condition.',
        error: 'Missing parameters',
      };
    }

    const { alertId, tokenSymbol, condition } = params;

    if (!alertId && !tokenSymbol) {
      return {
        success: false,
        text: 'Provide either alertId or tokenSymbol to identify the alert to remove.',
        error: 'Missing identifier',
      };
    }

    if (
      condition !== undefined &&
      condition !== 'above' &&
      condition !== 'below'
    ) {
      return {
        success: false,
        text: 'Condition must be "above" or "below".',
        error: 'Invalid condition',
      };
    }

    const [config] = await db
      .select({
        id: userAgentConfigs.id,
        priceAlerts: userAgentConfigs.priceAlerts,
      })
      .from(userAgentConfigs)
      .where(eq(userAgentConfigs.userId, agentUserId))
      .limit(1);

    if (!config) {
      return {
        success: false,
        text: 'Agent configuration not found.',
        error: 'Config not found',
      };
    }

    const storedAlerts = config.priceAlerts as PriceAlert[] | null;
    const alerts = storedAlerts ?? [];

    let removed: PriceAlert | undefined;

    if (alertId) {
      removed = alerts.find((a) => a.id === alertId);
    } else {
      const upperSymbol = normalizeSymbol(tokenSymbol);
      const matches = alerts.filter(
        (a) =>
          a.tokenSymbol === upperSymbol &&
          (!condition || a.condition === condition)
      );
      if (matches.length > 1) {
        return {
          success: false,
          text: `Multiple alerts match ${upperSymbol}. Specify condition ("above"/"below") or alertId.`,
          error: 'Ambiguous alert selector',
        };
      }
      removed = matches[0];
    }

    if (!removed) {
      return {
        success: false,
        text: `No matching price alert found${alertId ? ` with ID ${alertId}` : ` for ${tokenSymbol}`}.`,
        error: 'Alert not found',
      };
    }

    const removedId = removed.id;
    const remaining = alerts.filter((a) => a.id !== removedId);
    if (!(await writeAlertsIfUnchanged(config.id, storedAlerts, remaining))) {
      return CONCURRENT_UPDATE_RESULT;
    }

    logger.info(
      `[REMOVE_PRICE_ALERT] Removed alert: ${removed.tokenSymbol} ${removed.condition} ${removed.threshold}`,
      { agentUserId, alertId: removed.id },
      'ManagePriceAlerts'
    );

    return {
      success: true,
      text: `Removed price alert: ${removed.tokenSymbol} ${removed.condition} $${removed.threshold}.`,
      data: { removedAlert: removed },
    };
  },
};
