/**
 * Admin World Facts API
 *
 * @route GET /api/admin/world-facts - Get world facts
 * @route POST /api/admin/world-facts - Create/update/delete world facts and run admin actions
 * @access Admin
 *
 * @description
 * Manages world facts, RSS feeds, parody headlines, and character mappings.
 * GET returns all facts and related data. POST takes `{ action, data }`
 * validated per action (update_fact, add_fact, delete_fact, fetch_rss,
 * set_daily_topic_override, clear_daily_topic_override,
 * recompute_daily_topic, generate_parodies, refresh_mappings,
 * generate_world_facts).
 *
 * @openapi
 * /api/admin/world-facts:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get world facts
 *     description: Returns all world facts, RSS feeds, parodies, and mappings (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Facts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 facts:
 *                   type: array
 *                 rssFeeds:
 *                   type: array
 *                 parodies:
 *                   type: array
 *                 characterMappings:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *   post:
 *     tags:
 *       - Admin
 *     summary: Create/update world facts
 *     description: Creates or updates world facts (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Facts updated successfully
 *       400:
 *         description: Unknown action or invalid data for the action
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * const { facts } = await fetch('/api/admin/world-facts', {
 *   headers: { 'Authorization': `Bearer ${adminToken}` }
 * }).then(r => r.json());
 * ```
 */

import {
  errorResponse,
  requireAdmin,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { db } from '@feed/db';
import {
  characterMappingService,
  createParodyHeadlineGenerator,
  dailyTopicService,
  rssFeedService,
  worldFactsGenerator,
  worldFactsService,
} from '@feed/engine';
import { generateSnowflakeId, logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const FactValue = z.string().trim().min(1).max(2000);
const OptionalDate = z
  .object({
    date: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
      .optional(),
  })
  .optional();
const NoData = z.object({}).optional();

const WorldFactsActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_fact'),
    data: z.object({ id: z.string().min(1), value: FactValue }),
  }),
  z.object({
    action: z.literal('add_fact'),
    data: z.object({
      value: FactValue,
      category: z.literal('general').default('general'),
    }),
  }),
  z.object({
    action: z.literal('delete_fact'),
    data: z.object({ id: z.string().min(1) }),
  }),
  z.object({ action: z.literal('fetch_rss'), data: NoData }),
  z.object({
    action: z.literal('set_daily_topic_override'),
    data: z.object({
      topicLabel: z.string().trim().min(1, 'Missing topicLabel').max(200),
      summary: z.string().trim().max(2000).default(''),
      date: z
        .string()
        .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
        .optional(),
    }),
  }),
  z.object({
    action: z.literal('clear_daily_topic_override'),
    data: OptionalDate,
  }),
  z.object({ action: z.literal('recompute_daily_topic'), data: OptionalDate }),
  z.object({ action: z.literal('generate_parodies'), data: NoData }),
  z.object({ action: z.literal('refresh_mappings'), data: NoData }),
  z.object({ action: z.literal('generate_world_facts'), data: NoData }),
]);

const toDate = (value: string | undefined) =>
  value ? new Date(value) : new Date();

/**
 * GET /api/admin/world-facts - Get all world facts and related data
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const facts = await worldFactsService.getAllFacts();
  const rssFeeds = await rssFeedService.getUntransformedHeadlines(10);
  const parodyGenerator = createParodyHeadlineGenerator();
  const recentParodies = await parodyGenerator.getRecentParodies(10);
  const characterMappings =
    await characterMappingService.getCharacterMappings();
  const organizationMappings =
    await characterMappingService.getOrganizationMappings();

  const context = await worldFactsService.generateWorldContext(true);
  const dailyTopic = await dailyTopicService.getCurrentTopic();
  const dailyTopicCandidates = await dailyTopicService.listCandidates();

  // Load reality grounding content from TypeScript export
  const { realityGroundingContent: content } = await import('@feed/engine');
  const realityGroundingContent = content;

  return successResponse({
    facts,
    rssFeeds,
    recentParodies,
    characterMappings,
    organizationMappings,
    context,
    dailyTopic,
    dailyTopicCandidates,
    realityGroundingContent,
  });
});

/**
 * POST /api/admin/world-facts - Create or update world facts
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const parsed = WorldFactsActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return errorResponse(
      parsed.error.issues[0]?.message ?? 'Invalid request body',
      'VALIDATION_ERROR',
      400
    );
  }
  const body = parsed.data;

  switch (body.action) {
    case 'update_fact': {
      const { id, value } = body.data;
      const fact = await worldFactsService.updateFactById(id, value);
      logger.info(`Updated world fact: ${id}`, { fact }, 'WorldFactsAdmin');
      return successResponse({ fact });
    }

    case 'add_fact': {
      // Add a new fact by value (simple string). The key is derived from the
      // text before the first ':'; facts with the same category+key are
      // updated in place.
      const { value, category: factCategory } = body.data;
      const key = (value.split(':')[0] ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 50);
      if (!key) {
        return errorResponse(
          'Fact must start with an ASCII label (e.g. "Label: value")',
          'VALIDATION_ERROR',
          400
        );
      }
      const label = (value.split(':')[0] ?? '').trim().substring(0, 60);

      // Check if fact already exists
      const existing = await db.worldFact.findFirst({
        where: {
          AND: [
            { category: { equals: factCategory } },
            { key: { equals: key } },
          ],
        },
      });

      let fact;
      if (existing) {
        fact = await db.worldFact.update({
          where: { id: existing.id },
          data: {
            label,
            value,
            lastUpdated: new Date(),
          },
        });
      } else {
        fact = await db.worldFact.create({
          data: {
            id: await generateSnowflakeId(),
            category: factCategory,
            key,
            label,
            value,
            source: 'default',
            priority: 0,
            lastUpdated: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      logger.info(`Added world fact: ${fact.id}`, { fact }, 'WorldFactsAdmin');
      return successResponse({ fact });
    }

    case 'delete_fact': {
      await worldFactsService.deleteFact(body.data.id);
      logger.info(
        `Deleted world fact: ${body.data.id}`,
        undefined,
        'WorldFactsAdmin'
      );
      return successResponse({ success: true });
    }

    case 'fetch_rss': {
      // Trigger RSS feed fetch manually
      const result = await rssFeedService.fetchAllFeeds();
      logger.info('Manual RSS fetch triggered', result, 'WorldFactsAdmin');
      return successResponse({ result });
    }

    case 'set_daily_topic_override': {
      const { topicLabel, summary, date } = body.data;
      const topic = await dailyTopicService.setManualTopic({
        date: toDate(date),
        topicLabel,
        summary,
      });
      return successResponse({ topic });
    }

    case 'clear_daily_topic_override': {
      const topic = await dailyTopicService.clearOverride(
        toDate(body.data?.date)
      );
      return successResponse({ topic });
    }

    case 'recompute_daily_topic': {
      const topic = await dailyTopicService.recomputeTopicForDate(
        toDate(body.data?.date)
      );
      return successResponse({ topic });
    }

    case 'generate_parodies': {
      // Generate parodies from untransformed headlines
      const headlines = await rssFeedService.getUntransformedHeadlines(10);
      const generator = createParodyHeadlineGenerator();
      const parodies = await generator.processHeadlines(headlines);
      logger.info(
        `Generated ${parodies.length} parody headlines`,
        undefined,
        'WorldFactsAdmin'
      );
      return successResponse({ parodies });
    }

    case 'refresh_mappings': {
      // Refresh character/org mapping cache
      characterMappingService.refreshCache();
      return successResponse({ success: true });
    }

    case 'generate_world_facts': {
      // Generate new world facts from game activity
      logger.info(
        'Manual world facts generation triggered',
        undefined,
        'WorldFactsAdmin'
      );
      const result = await worldFactsGenerator.generateNewWorldFacts();
      logger.info(
        `Generated ${result.generated} world facts, archived ${result.archived}`,
        result,
        'WorldFactsAdmin'
      );
      return successResponse({ result });
    }
  }
});
