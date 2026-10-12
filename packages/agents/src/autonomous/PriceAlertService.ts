/**
 * Price Alert Service
 *
 * Monitors perpetual market prices against user-configured thresholds
 * and delivers alerts via team chat or group chat.
 *
 * Called during each autonomous agent tick (~3 minutes). Checks are
 * non-LLM (pure DB lookups) so they add negligible latency to the tick.
 *
 * Alert delivery:
 * - team_chat: Uses executeDirectMessage with the team chat's chatId
 * - group: Uses executeDirectMessage with the configured group chatId
 *
 * Note: Agent→owner DMs are blocked by executeDirectMessage (DirectExecutors.ts:1392).
 * Owner alerts use team chat instead.
 */

import {
  and,
  chatParticipants,
  chats,
  db,
  eq,
  perpMarketSnapshots,
  sql,
  userAgentConfigs,
  users,
} from '@feed/db';
import type { PriceAlert } from '@feed/db/schema';
// Import TeamChatService to resolve the team chat for owner alerts
import { teamChatService } from '../services/TeamChatService';
import { logger } from '../shared/logger';
import { executeDirectMessage } from './DirectExecutors';

const DEFAULT_COOLDOWN_MINUTES = 15;

export type AlertCooldownState =
  | { status: 'ready' }
  | { status: 'cooling-down' }
  | { status: 'invalid'; reason: string };

/**
 * Validate an alert's numeric config and evaluate its cooldown at `nowMs`.
 * An explicit cooldown of 0 is honored (no cooldown); a missing one uses the
 * default. Invalid thresholds/cooldowns/timestamps are reported instead of
 * silently disabling the cooldown or producing Infinity percentages.
 */
export function evaluateAlertCooldown(
  alert: Pick<PriceAlert, 'threshold' | 'lastTriggeredAt'> & {
    cooldownMinutes?: number;
  },
  nowMs: number
): AlertCooldownState {
  if (!Number.isFinite(alert.threshold) || alert.threshold <= 0) {
    return { status: 'invalid', reason: 'threshold must be a positive number' };
  }
  const cooldownMinutes = alert.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
    return { status: 'invalid', reason: 'cooldownMinutes must be >= 0' };
  }
  if (!alert.lastTriggeredAt) return { status: 'ready' };
  const lastMs = new Date(alert.lastTriggeredAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return { status: 'invalid', reason: 'lastTriggeredAt is not a valid date' };
  }
  return nowMs - lastMs < cooldownMinutes * 60 * 1000
    ? { status: 'cooling-down' }
    : { status: 'ready' };
}

/**
 * Price Alert Service
 *
 * Checks configured price alerts for an agent and sends notifications
 * when thresholds are breached.
 */
export class PriceAlertService {
  /**
   * Check all price alerts for an agent during autonomous tick.
   * Returns the number of alerts triggered and sent.
   */
  async checkAlerts(agentUserId: string): Promise<number> {
    const [config] = await db
      .select({ priceAlerts: userAgentConfigs.priceAlerts })
      .from(userAgentConfigs)
      .where(eq(userAgentConfigs.userId, agentUserId))
      .limit(1);

    const alerts = (config?.priceAlerts ?? []) as PriceAlert[];
    const enabledAlerts = alerts.filter((a) => a.enabled);

    if (enabledAlerts.length === 0) return 0;

    let alertsSent = 0;

    for (const alert of enabledAlerts) {
      const cooldown = evaluateAlertCooldown(alert, Date.now());
      if (cooldown.status === 'invalid') {
        logger.warn(
          `[PriceAlert] Skipping invalid alert ${alert.id}: ${cooldown.reason}`,
          { agentUserId, tokenSymbol: alert.tokenSymbol },
          'PriceAlertService'
        );
        continue;
      }
      if (cooldown.status === 'cooling-down') continue;

      // Get current price from perpetual market snapshots
      const currentPrice = await this.getCurrentPrice(alert.tokenSymbol);
      if (currentPrice === null) continue;

      // Check threshold
      const triggered =
        (alert.condition === 'below' && currentPrice < alert.threshold) ||
        (alert.condition === 'above' && currentPrice > alert.threshold);

      if (!triggered) continue;

      // Resolve delivery target
      const message = this.formatAlertMessage(alert, currentPrice);
      let deliveryChatId: string | undefined;

      if (alert.deliveryChannel === 'group' && alert.deliveryChatId) {
        // Re-check membership at delivery time: the agent may have left the
        // group since the alert was created.
        if (
          !(await this.isActiveGroupMember(agentUserId, alert.deliveryChatId))
        ) {
          logger.warn(
            `[PriceAlert] Agent is not an active member of group ${alert.deliveryChatId}; skipping alert ${alert.id}`,
            { agentUserId, tokenSymbol: alert.tokenSymbol },
            'PriceAlertService'
          );
          continue;
        }
        deliveryChatId = alert.deliveryChatId;
      } else {
        // Default: deliver to team chat (agent→owner standard channel)
        deliveryChatId = await this.getOwnerTeamChatId(agentUserId);
      }

      if (!deliveryChatId) {
        logger.warn(
          `[PriceAlert] No delivery channel found for alert ${alert.id}`,
          { agentUserId, tokenSymbol: alert.tokenSymbol },
          'PriceAlertService'
        );
        continue;
      }

      // Claim the trigger atomically before sending: the claim only succeeds
      // if the alert still exists, is still enabled and its lastTriggeredAt is
      // unchanged since we read it, so concurrent ticks cannot double-send.
      const claimedAt = new Date().toISOString();
      const claimed = await this.setAlertTriggerIfUnchanged(
        agentUserId,
        alert.id,
        alert.lastTriggeredAt ?? null,
        claimedAt
      );
      if (!claimed) continue;

      const result = await executeDirectMessage({
        agentUserId,
        chatId: deliveryChatId,
        content: message,
      });

      if (result.success) {
        alertsSent++;
        logger.info(
          `[PriceAlert] Alert triggered: ${alert.tokenSymbol} ${alert.condition} ${alert.threshold} (current: ${currentPrice})`,
          { agentUserId, alertId: alert.id, chatId: deliveryChatId },
          'PriceAlertService'
        );
      } else {
        // Release our claim so the alert can retry next tick.
        await this.setAlertTriggerIfUnchanged(
          agentUserId,
          alert.id,
          claimedAt,
          alert.lastTriggeredAt ?? null
        );
        logger.warn(
          `[PriceAlert] Failed to send alert: ${result.error}`,
          { agentUserId, alertId: alert.id },
          'PriceAlertService'
        );
      }
    }

    return alertsSent;
  }

  /**
   * Format a price alert message for delivery.
   */
  private formatAlertMessage(alert: PriceAlert, currentPrice: number): string {
    const direction =
      alert.condition === 'below' ? 'dropped below' : 'rose above';
    const emoji = alert.condition === 'below' ? '📉' : '📈';
    const diff = Math.abs(currentPrice - alert.threshold);
    const pctDiff = ((diff / alert.threshold) * 100).toFixed(1);

    return `${emoji} Price Alert: ${alert.tokenSymbol} has ${direction} $${alert.threshold}. Current price: $${currentPrice.toFixed(2)} (${pctDiff}% ${alert.condition === 'below' ? 'below' : 'above'} threshold).`;
  }

  /**
   * Get current market price for a token symbol from perpMarketSnapshots.
   * Returns markPrice if available, otherwise currentPrice.
   */
  private async getCurrentPrice(tokenSymbol: string): Promise<number | null> {
    const [snapshot] = await db
      .select({
        currentPrice: perpMarketSnapshots.currentPrice,
        markPrice: perpMarketSnapshots.markPrice,
      })
      .from(perpMarketSnapshots)
      .where(eq(perpMarketSnapshots.ticker, tokenSymbol))
      .limit(1);

    return snapshot?.markPrice ?? snapshot?.currentPrice ?? null;
  }

  /**
   * Get the team chat ID for an agent's owner.
   * Agents communicate with owners via the team chat (Agents group).
   */
  private async getOwnerTeamChatId(
    agentUserId: string
  ): Promise<string | undefined> {
    // Find the agent's owner
    const [agent] = await db
      .select({ managedBy: users.managedBy })
      .from(users)
      .where(eq(users.id, agentUserId))
      .limit(1);

    if (!agent?.managedBy) return undefined;

    // Get the owner's team chat
    const teamChat = await teamChatService.getTeamChat(agent.managedBy);
    return teamChat?.chatId;
  }

  /** Whether the agent is an active participant of the given group chat. */
  private async isActiveGroupMember(
    agentUserId: string,
    chatId: string
  ): Promise<boolean> {
    const [membership] = await db
      .select({ chatId: chatParticipants.chatId })
      .from(chatParticipants)
      .innerJoin(chats, eq(chats.id, chatParticipants.chatId))
      .where(
        and(
          eq(chatParticipants.chatId, chatId),
          eq(chatParticipants.userId, agentUserId),
          eq(chatParticipants.isActive, true),
          eq(chats.isGroup, true)
        )
      )
      .limit(1);
    return Boolean(membership);
  }

  /**
   * Set lastTriggeredAt for one enabled alert only if its current value equals
   * `expected` (null = never triggered). Single atomic UPDATE; returns whether
   * a row was changed.
   * Column is json (not jsonb), so cast to jsonb for processing, then back to json.
   */
  private async setAlertTriggerIfUnchanged(
    agentUserId: string,
    alertId: string,
    expected: string | null,
    next: string | null
  ): Promise<boolean> {
    const updated = await db
      .update(userAgentConfigs)
      .set({
        priceAlerts: sql`(
          SELECT COALESCE(
            jsonb_agg(
              CASE
                WHEN elem->>'id' = ${alertId}
                THEN CASE
                  WHEN ${next}::text IS NULL THEN elem - 'lastTriggeredAt'
                  ELSE elem || jsonb_build_object('lastTriggeredAt', ${next}::text)
                END
                ELSE elem
              END
            ),
            '[]'::jsonb
          )::json
          FROM jsonb_array_elements(
            COALESCE(${userAgentConfigs.priceAlerts}::jsonb, '[]'::jsonb)
          ) AS elem
        )`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userAgentConfigs.userId, agentUserId),
          sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              COALESCE(${userAgentConfigs.priceAlerts}::jsonb, '[]'::jsonb)
            ) AS cur
            WHERE cur->>'id' = ${alertId}
              AND (cur->>'enabled')::boolean IS TRUE
              AND (cur->>'lastTriggeredAt') IS NOT DISTINCT FROM ${expected}::text
          )`
        )
      )
      .returning({ id: userAgentConfigs.id });
    return updated.length > 0;
  }
}

export const priceAlertService = new PriceAlertService();
