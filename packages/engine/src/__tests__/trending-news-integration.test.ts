/**
 * Integration Tests for Trending Topics & News Article System
 *
 * Tests the complete flow from question creation through resolution
 * with trending topics and news article generation.
 */

/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ArticleGenerator } from '../ArticleGenerator';
import { FeedGenerator } from '../FeedGenerator';
import type { FeedLLMClient } from '../llm/openai-client';
import { TrendingTopicsEngine } from '../TrendingTopicsEngine';
import type { Actor, FeedPost, Organization, Question } from '../types/shared';

/**
 * Mock LLM client interface for testing
 */
interface MockLLMClient
  extends Pick<FeedLLMClient, 'generateJSON' | 'getProvider'> {}

describe('Trending Topics & News Integration', () => {
  let trendEngine: TrendingTopicsEngine;
  let articleGen: ArticleGenerator;
  let feedGen: FeedGenerator;
  let mockLLM: FeedLLMClient;

  const mockQuestion: Question = {
    id: 1,
    text: 'Will TechCorp announce AI breakthrough?',
    scenario: 1,
    outcome: true,
    rank: 1,
    status: 'active',
    createdDate: '2025-11-01',
    resolutionDate: '2025-11-05',
  };

  const mockOrgs: Organization[] = [
    {
      id: 'msdnc',
      name: 'MSDNC',
      type: 'media',
      description: 'Progressive news network',
      canBeInvolved: true,
    },
    {
      id: 'the-fud',
      name: 'The Fud',
      type: 'media',
      description: 'Investigative journalism',
      canBeInvolved: true,
    },
    {
      id: 'channel-7',
      name: 'Channel 7',
      type: 'media',
      description: 'Breaking news',
      canBeInvolved: true,
    },
    {
      id: 'xitter',
      name: 'Xitter',
      type: 'media',
      description: 'Social media platform',
      canBeInvolved: true,
    },
    {
      id: 'bbc',
      name: 'BBC',
      type: 'media',
      description: 'Global news',
      canBeInvolved: true,
    },
  ];

  const mockActors: Actor[] = [
    {
      id: 'actor-1',
      name: 'AIlon Musk',
      tier: 'S_TIER',
      role: 'main',
      description: 'Tech billionaire',
      domain: ['tech'],
      personality: 'bold',
      affiliations: ['tech-corp'],
    },
  ];

  beforeEach(() => {
    const mockImpl: MockLLMClient = {
      getProvider: () => 'openai',
      generateJSON: mock(async (prompt: string) => {
        // The trending topics prompt contains "TRENDING REQUIREMENTS" not "TRENDING TOPICS"
        if (prompt.includes('TRENDING REQUIREMENTS')) {
          return {
            trends: [
              {
                tag: 'ai',
                trendName: 'AI Breakthrough Buzz',
                description:
                  'Tech community debates potential TechCorp announcement.',
              },
              {
                tag: 'techcorp',
                trendName: 'Market Speculation',
                description: 'Traders position ahead of expected news.',
              },
            ],
          };
        }

        if (prompt.includes('journalist writing for')) {
          const content =
            'TechCorp is reportedly preparing a major AI breakthrough announcement. '.repeat(
              45
            );
          return {
            response: {
              title: 'TechCorp AI Announcement Imminent, Sources Say',
              summary:
                'Multiple sources confirm TechCorp preparing major AI reveal.',
              content,
              slant: 'Optimistic about breakthrough potential',
              sentiment: 'positive',
              category: 'tech',
              tags: { tag: ['ai', 'techcorp', 'breakthrough'] },
            },
          };
        }

        return {};
      }),
    };
    mockLLM = mockImpl as FeedLLMClient;

    trendEngine = new TrendingTopicsEngine(mockLLM);
    articleGen = new ArticleGenerator(mockLLM);
    feedGen = new FeedGenerator(mockLLM);

    feedGen.setTrendingTopics(trendEngine);
  });

  describe('Article generation per question stage', () => {
    for (const stage of ['breaking', 'commentary', 'resolution'] as const) {
      it(`generates a validated ${stage} article for an organization`, async () => {
        const article = await articleGen.generateArticleForQuestion(
          mockQuestion,
          mockOrgs[0]!,
          stage,
          mockActors,
          []
        );

        expect(article.title).toBe(
          'TechCorp AI Announcement Imminent, Sources Say'
        );
        expect(article.content.length).toBeGreaterThan(100);
      });
    }
  });

  describe('Trending Topics Integration', () => {
    it('should update trends from feed posts', async () => {
      const posts: FeedPost[] = [
        {
          id: 'post-1',
          content: 'AI breakthrough imminent',
          author: 'user-1',
          authorName: 'User1',
          timestamp: '2025-11-15T10:00:00Z',
          day: 1,
          tags: ['ai', 'breakthrough', 'techcorp'],
          relatedQuestion: 1,
        },
        {
          id: 'post-2',
          content: 'TechCorp announcement expected',
          author: 'user-2',
          authorName: 'User2',
          timestamp: '2025-11-15T10:05:00Z',
          day: 1,
          tags: ['techcorp', 'ai'],
          relatedQuestion: 1,
        },
      ];

      await trendEngine.updateTrends(posts, 10);
      const trends = trendEngine.getTrends();

      expect(trends.length).toBeGreaterThan(0);
      expect(trends[0]?.relatedQuestions).toContain(1);
    });

    it('should provide trend context to feed generator', () => {
      feedGen.updateTrendContext();

      const context = feedGen['trendContext'];
      expect(context).toBeDefined();
      expect(context.trim().length).toBeGreaterThan(0);
      expect(context).toContain('TRENDING TOPICS');
    });

    it('exposes LLM-generated trend names in the feed trend context', async () => {
      const posts: FeedPost[] = [
        {
          id: 'post-1',
          content: 'Test',
          author: 'user-1',
          authorName: 'User',
          timestamp: '2025-11-15T10:00:00Z',
          day: 1,
          tags: ['ai'],
        },
      ];

      await trendEngine.updateTrends(posts, 10);
      feedGen.updateTrendContext();

      const context = feedGen['trendContext'];
      expect(context).toContain('AI Breakthrough Buzz');
    });
  });

  describe('Error Handling', () => {
    it('should throw on invalid question for article generation', async () => {
      const invalidQuestion = {
        id: 0,
        text: '',
        scenario: 1,
        outcome: true,
        rank: 1,
      } as Question;

      await expect(
        articleGen.generateArticleForQuestion(
          invalidQuestion,
          mockOrgs[0]!,
          'breaking',
          mockActors,
          []
        )
      ).rejects.toThrow('Invalid question');
    });

    it('should throw on invalid organization for article generation', async () => {
      const invalidOrg = {
        id: '',
        name: '',
        type: 'media',
        description: 'Invalid org',
        canBeInvolved: false,
      } as Organization;

      await expect(
        articleGen.generateArticleForQuestion(
          mockQuestion,
          invalidOrg,
          'breaking',
          mockActors,
          []
        )
      ).rejects.toThrow('Invalid organization');
    });

    it('should throw on empty actors array', async () => {
      await expect(
        articleGen.generateArticleForQuestion(
          mockQuestion,
          mockOrgs[0]!,
          'breaking',
          [], // Empty!
          []
        )
      ).rejects.toThrow('Actors array cannot be empty');
    });

    it('should propagate LLM failures (fail-fast)', async () => {
      const failingImpl: MockLLMClient = {
        generateJSON: mock(async () => {
          throw new Error('LLM timeout');
        }),
        getProvider: () => 'openai',
      };
      const failingLLM = failingImpl as FeedLLMClient;

      const engine = new TrendingTopicsEngine(failingLLM);
      engine.setUpdateInterval(10);

      const posts: FeedPost[] = [
        {
          id: 'post-1',
          content: 'Test',
          author: 'user-1',
          authorName: 'User',
          timestamp: '2025-11-15T10:00:00Z',
          day: 1,
          tags: ['test'],
        },
      ];

      // LLM failures should propagate, not be swallowed
      await expect(engine.updateTrends(posts, 10)).rejects.toThrow(
        'LLM timeout'
      );
    });
  });

  describe('Context Validation', () => {
    it('should never provide empty trend context to agents', async () => {
      feedGen.updateTrendContext();
      let context = feedGen['trendContext'];
      expect(context.trim()).not.toBe('');
      expect(context).toContain('TRENDING TOPICS');

      await trendEngine.updateTrends([], 10);
      feedGen.updateTrendContext();
      context = feedGen['trendContext'];
      expect(context.trim()).not.toBe('');
      expect(context).toContain('TRENDING TOPICS');
    });

    it('should throw if trending engine returns invalid context', () => {
      const badEngine = {
        getDetailedTrendContext: () => '',
      } as Pick<
        TrendingTopicsEngine,
        'getDetailedTrendContext'
      > as TrendingTopicsEngine;

      feedGen.setTrendingTopics(badEngine);

      expect(() => {
        feedGen.updateTrendContext();
      }).toThrow('TrendingTopicsEngine returned empty context');
    });
  });

  describe('Article Quality Validation', () => {
    it('should throw if article has empty title', async () => {
      const badImpl: MockLLMClient = {
        getProvider: () => 'openai',
        generateJSON: mock(async () => ({
          response: {
            title: '',
            summary: 'Test summary',
            content: 'Content '.repeat(100),
            slant: 'neutral',
            sentiment: 'neutral',
            category: 'tech',
            tags: { tag: ['test'] },
          },
        })),
      };
      const badLLM = badImpl as FeedLLMClient;

      const badArticleGen = new ArticleGenerator(badLLM);

      await expect(
        badArticleGen.generateArticleForQuestion(
          mockQuestion,
          mockOrgs[0]!,
          'breaking',
          mockActors,
          []
        )
      ).rejects.toThrow('empty title');
    });

    it('should throw if article has empty summary', async () => {
      const badImpl: MockLLMClient = {
        getProvider: () => 'openai',
        generateJSON: mock(async () => ({
          response: {
            title: 'Test Title',
            summary: '',
            content: 'Content '.repeat(100),
            slant: 'neutral',
            sentiment: 'neutral',
            category: 'tech',
            tags: { tag: ['test'] },
          },
        })),
      };
      const badLLM = badImpl as FeedLLMClient;

      const badArticleGen = new ArticleGenerator(badLLM);

      await expect(
        badArticleGen.generateArticleForQuestion(
          mockQuestion,
          mockOrgs[0]!,
          'breaking',
          mockActors,
          []
        )
      ).rejects.toThrow('empty summary');
    });

    it('should throw if article content is too short', async () => {
      const badImpl: MockLLMClient = {
        getProvider: () => 'openai',
        generateJSON: mock(async () => ({
          response: {
            title: 'Test Title',
            summary: 'Test summary',
            content: 'Short', // < 100 chars
            slant: 'neutral',
            sentiment: 'neutral',
            category: 'tech',
            tags: { tag: ['test'] },
          },
        })),
      };
      const badLLM = badImpl as FeedLLMClient;

      const badArticleGen = new ArticleGenerator(badLLM);

      await expect(
        badArticleGen.generateArticleForQuestion(
          mockQuestion,
          mockOrgs[0]!,
          'breaking',
          mockActors,
          []
        )
      ).rejects.toThrow('content too short');
    });
  });

  describe('Trend Evolution', () => {
    it('should evolve trends as new posts arrive', async () => {
      const initialPosts: FeedPost[] = [
        {
          id: 'post-1',
          content: 'AI news',
          author: 'user-1',
          authorName: 'User1',
          timestamp: '2025-11-15T10:00:00Z',
          day: 1,
          tags: ['ai'],
        },
      ];

      await trendEngine.updateTrends(initialPosts, 10);
      const trends1 = trendEngine.getTrends();

      const newPosts: FeedPost[] = [
        ...initialPosts,
        {
          id: 'post-2',
          content: 'Crypto news',
          author: 'user-2',
          authorName: 'User2',
          timestamp: '2025-11-15T10:30:00Z',
          day: 10,
          tags: ['crypto', 'defi'],
        },
        {
          id: 'post-3',
          content: 'More crypto',
          author: 'user-3',
          authorName: 'User3',
          timestamp: '2025-11-15T10:35:00Z',
          day: 10,
          tags: ['crypto'],
        },
      ];

      await trendEngine.updateTrends(newPosts, 20);
      const trends2 = trendEngine.getTrends();

      expect(trends2).not.toEqual(trends1);
    });
  });

  describe('Trend batching', () => {
    it('caps trends at the top 5 topics', async () => {
      const posts: FeedPost[] = Array.from({ length: 100 }, (_, i) => ({
        id: `post-${i}`,
        content: `Post ${i}`,
        author: `user-${i}`,
        authorName: `User${i}`,
        timestamp: '2025-11-15T10:00:00Z',
        day: 1,
        tags: [`tag-${i % 10}`], // 10 different tags
      }));

      await trendEngine.updateTrends(posts, 10);

      const trends = trendEngine.getTrends();
      expect(trends.length).toBeLessThanOrEqual(5);
    });

    it('should batch LLM calls for trend descriptions', async () => {
      const posts: FeedPost[] = Array.from({ length: 20 }, (_, i) => ({
        id: `post-${i}`,
        content: `Post ${i}`,
        author: `user-${i}`,
        authorName: `User${i}`,
        timestamp: '2025-11-15T10:00:00Z',
        day: 1,
        tags: [`tag-${i % 10}`],
      }));

      await trendEngine.updateTrends(posts, 10);

      expect(
        (mockLLM.generateJSON as ReturnType<typeof mock>).mock.calls.length
      ).toBe(1);
    });
  });
});
