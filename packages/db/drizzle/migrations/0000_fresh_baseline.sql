CREATE TYPE "public"."AgentStatus" AS ENUM('REGISTERED', 'INITIALIZED', 'ACTIVE', 'PAUSED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."AgentType" AS ENUM('USER_CONTROLLED', 'NPC', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."OnboardingStatus" AS ENUM('PENDING_PROFILE', 'PENDING_ONCHAIN', 'ONCHAIN_IN_PROGRESS', 'ONCHAIN_FAILED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."RealtimeOutboxStatus" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."SentryIncidentAlertOutboxStatus" AS ENUM('pending', 'processing', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."SentryIncidentRunDecision" AS ENUM('pending', 'skip_linear', 'reuse_linear', 'create_linear', 'process_issue');--> statement-breakpoint
CREATE TYPE "public"."SentryIncidentRunStatus" AS ENUM('running', 'completed', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."SentryWebhookInboxStatus" AS ENUM('pending', 'processing', 'processed', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."group_type" AS ENUM('user', 'npc', 'agent', 'team');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('user', 'system', 'coordinator');--> statement-breakpoint
CREATE TABLE "AchievementDefinition" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"tier" text NOT NULL,
	"iconKey" text NOT NULL,
	"pointsReward" integer NOT NULL,
	"threshold" integer NOT NULL,
	"trackingType" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ChallengeDefinition" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"pool" text NOT NULL,
	"category" text NOT NULL,
	"iconKey" text NOT NULL,
	"pointsReward" integer NOT NULL,
	"threshold" integer NOT NULL,
	"trackingType" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserAchievement" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"achievementId" text NOT NULL,
	"unlockedAt" timestamp DEFAULT now() NOT NULL,
	"pointsAwarded" integer NOT NULL,
	CONSTRAINT "UserAchievement_userId_achievementId_idx" UNIQUE("userId","achievementId")
);
--> statement-breakpoint
CREATE TABLE "UserChallengeProgress" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"challengeId" text NOT NULL,
	"periodKey" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"completedAt" timestamp,
	"pointsAwarded" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserChallengeProgress_userId_challengeId_periodKey_idx" UNIQUE("userId","challengeId","periodKey")
);
--> statement-breakpoint
CREATE TABLE "ActorState" (
	"id" text PRIMARY KEY NOT NULL,
	"tradingBalance" numeric(18, 2) DEFAULT '10000' NOT NULL,
	"reputationPoints" integer DEFAULT 10000 NOT NULL,
	"hasPool" boolean DEFAULT false NOT NULL,
	"lastPostAt" timestamp,
	"lastActiveAt" timestamp,
	"postsToday" integer DEFAULT 0 NOT NULL,
	"postsTodayResetAt" timestamp,
	"currentMood" numeric(4, 3) DEFAULT '0',
	"recentMemories" jsonb DEFAULT '[]'::jsonb,
	"relationships" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "positive_trading_balance" CHECK ("ActorState"."tradingBalance" >= 0),
	CONSTRAINT "current_mood_bounds" CHECK ("ActorState"."currentMood" >= -1 AND "ActorState"."currentMood" <= 1)
);
--> statement-breakpoint
CREATE TABLE "ActorFollow" (
	"id" text PRIMARY KEY NOT NULL,
	"followerId" text NOT NULL,
	"followingId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"isMutual" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ActorRelationship" (
	"id" text PRIMARY KEY NOT NULL,
	"actor1Id" text NOT NULL,
	"actor2Id" text NOT NULL,
	"relationshipType" text NOT NULL,
	"strength" double precision NOT NULL,
	"sentiment" double precision NOT NULL,
	"isPublic" boolean DEFAULT true NOT NULL,
	"history" text,
	"affects" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"lastInteraction" timestamp,
	"interactionCount" integer DEFAULT 0 NOT NULL,
	"evolutionCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NPCInteraction" (
	"id" text PRIMARY KEY NOT NULL,
	"actor1Id" text NOT NULL,
	"actor2Id" text NOT NULL,
	"interactionType" text NOT NULL,
	"sentiment" double precision DEFAULT 0 NOT NULL,
	"context" text NOT NULL,
	"metadata" json,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NPCTrade" (
	"id" text PRIMARY KEY NOT NULL,
	"npcActorId" text NOT NULL,
	"poolId" text,
	"marketType" text NOT NULL,
	"ticker" text,
	"marketId" text,
	"action" text NOT NULL,
	"side" text,
	"amount" double precision NOT NULL,
	"price" double precision NOT NULL,
	"sentiment" double precision,
	"reason" text,
	"postId" text,
	"executedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AdminRole" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"permissions" text[],
	"grantedBy" text NOT NULL,
	"grantedAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	CONSTRAINT "AdminRole_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "SystemMetricsSnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp NOT NULL,
	"environment" text NOT NULL,
	"totalUsers" integer NOT NULL,
	"activeUsers" integer NOT NULL,
	"newSignups" integer NOT NULL,
	"tradingVolume" numeric(18, 2) NOT NULL,
	"activeMarkets" integer NOT NULL,
	"openPositions" integer NOT NULL,
	"perpVolume" numeric(18, 2) DEFAULT '0' NOT NULL,
	"activePerpPositions" integer DEFAULT 0 NOT NULL,
	"postsCreated" integer DEFAULT 0 NOT NULL,
	"commentsCreated" integer DEFAULT 0 NOT NULL,
	"reactionsCreated" integer DEFAULT 0 NOT NULL,
	"totalVirtualBalance" numeric(20, 2) NOT NULL,
	"feesCollectedHourly" numeric(18, 2) NOT NULL,
	"apiUptime" double precision NOT NULL,
	"avgResponseTime" double precision NOT NULL,
	"errorRate" double precision NOT NULL,
	"cronJobsHealthy" integer DEFAULT 0 NOT NULL,
	"cronJobsUnhealthy" integer DEFAULT 0 NOT NULL,
	"extendedMetrics" json,
	"snapshotDurationMs" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentCapability" (
	"id" text PRIMARY KEY NOT NULL,
	"agentRegistryId" text NOT NULL,
	"strategies" text[] DEFAULT '{}' NOT NULL,
	"markets" text[] DEFAULT '{}' NOT NULL,
	"actions" text[] DEFAULT '{}' NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"x402Support" boolean DEFAULT false NOT NULL,
	"platform" text,
	"userType" text,
	"gameNetworkChainId" integer,
	"gameNetworkRpcUrl" text,
	"gameNetworkExplorerUrl" text,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"a2aEndpoint" text,
	"mcpEndpoint" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "AgentCapability_agentRegistryId_unique" UNIQUE("agentRegistryId")
);
--> statement-breakpoint
CREATE TABLE "AgentGoalAction" (
	"id" text PRIMARY KEY NOT NULL,
	"goalId" text NOT NULL,
	"agentUserId" text NOT NULL,
	"actionType" text NOT NULL,
	"actionId" text,
	"impact" double precision NOT NULL,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentGoal" (
	"id" text PRIMARY KEY NOT NULL,
	"agentUserId" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"target" json,
	"priority" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "AgentLog" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"prompt" text,
	"completion" text,
	"thinking" text,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"agentUserId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentMessage" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"modelUsed" text,
	"pointsCost" integer DEFAULT 0 NOT NULL,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"agentUserId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentPerformanceMetrics" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"gamesPlayed" integer DEFAULT 0 NOT NULL,
	"gamesWon" integer DEFAULT 0 NOT NULL,
	"averageGameScore" double precision DEFAULT 0 NOT NULL,
	"lastGameScore" double precision,
	"lastGamePlayedAt" timestamp,
	"normalizedPnL" double precision DEFAULT 0.5 NOT NULL,
	"totalTrades" integer DEFAULT 0 NOT NULL,
	"profitableTrades" integer DEFAULT 0 NOT NULL,
	"winRate" double precision DEFAULT 0 NOT NULL,
	"averageROI" double precision DEFAULT 0 NOT NULL,
	"sharpeRatio" double precision,
	"totalFeedbackCount" integer DEFAULT 0 NOT NULL,
	"averageFeedbackScore" double precision DEFAULT 70 NOT NULL,
	"intelFeedbackCount" integer DEFAULT 0 NOT NULL,
	"averageIntelScore" double precision DEFAULT 50 NOT NULL,
	"averageRating" double precision,
	"positiveCount" integer DEFAULT 0 NOT NULL,
	"neutralCount" integer DEFAULT 0 NOT NULL,
	"negativeCount" integer DEFAULT 0 NOT NULL,
	"reputationScore" double precision DEFAULT 70 NOT NULL,
	"trustLevel" text DEFAULT 'UNRATED' NOT NULL,
	"confidenceScore" double precision DEFAULT 0 NOT NULL,
	"onChainReputationSync" boolean DEFAULT false NOT NULL,
	"lastSyncedAt" timestamp,
	"onChainTrustScore" double precision,
	"onChainAccuracyScore" double precision,
	"firstActivityAt" timestamp,
	"lastActivityAt" timestamp,
	"totalInteractions" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "AgentPerformanceMetrics_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "AgentPointsTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"balanceBefore" numeric(18, 2) NOT NULL,
	"balanceAfter" numeric(18, 2) NOT NULL,
	"description" text NOT NULL,
	"relatedId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"agentUserId" text NOT NULL,
	"managerUserId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentRegistry" (
	"id" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"type" "AgentType" NOT NULL,
	"status" "AgentStatus" DEFAULT 'REGISTERED' NOT NULL,
	"trustLevel" integer DEFAULT 0 NOT NULL,
	"userId" text,
	"actorId" text,
	"name" text NOT NULL,
	"systemPrompt" text NOT NULL,
	"discoveryCardVersion" text,
	"discoveryEndpointA2a" text,
	"discoveryEndpointMcp" text,
	"discoveryEndpointRpc" text,
	"discoveryAuthRequired" boolean DEFAULT false NOT NULL,
	"discoveryAuthMethods" text[] DEFAULT '{}' NOT NULL,
	"discoveryRateLimit" integer,
	"discoveryCostPerAction" double precision,
	"onChainTokenId" integer,
	"onChainTxHash" text,
	"onChainServerWallet" text,
	"onChainReputationScore" integer DEFAULT 0,
	"onChainChainId" integer,
	"onChainIdentityRegistry" text,
	"onChainReputationSystem" text,
	"agent0TokenId" text,
	"agent0MetadataCID" text,
	"agent0SubgraphOwner" text,
	"agent0SubgraphMetadataURI" text,
	"agent0SubgraphTimestamp" integer,
	"agent0DiscoveryEndpoint" text,
	"runtimeInstanceId" text,
	"registeredAt" timestamp DEFAULT now() NOT NULL,
	"lastActiveAt" timestamp,
	"terminatedAt" timestamp,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "AgentRegistry_agentId_unique" UNIQUE("agentId"),
	CONSTRAINT "AgentRegistry_userId_unique" UNIQUE("userId"),
	CONSTRAINT "AgentRegistry_actorId_unique" UNIQUE("actorId"),
	CONSTRAINT "AgentRegistry_runtimeInstanceId_unique" UNIQUE("runtimeInstanceId")
);
--> statement-breakpoint
CREATE TABLE "AgentTrade" (
	"id" text PRIMARY KEY NOT NULL,
	"marketType" text NOT NULL,
	"marketId" text,
	"ticker" text,
	"action" text NOT NULL,
	"side" text,
	"amount" double precision NOT NULL,
	"price" double precision NOT NULL,
	"pnl" double precision,
	"reasoning" text,
	"executedAt" timestamp DEFAULT now() NOT NULL,
	"agentUserId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExternalAgentConnection" (
	"id" text PRIMARY KEY NOT NULL,
	"agentRegistryId" text NOT NULL,
	"externalId" text NOT NULL,
	"endpoint" text NOT NULL,
	"protocol" text NOT NULL,
	"authType" text,
	"authCredentials" text,
	"agentCardJson" json,
	"isHealthy" boolean DEFAULT true NOT NULL,
	"lastHealthCheck" timestamp,
	"lastConnected" timestamp,
	"registeredByUserId" text,
	"revokedAt" timestamp,
	"revokedBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "ExternalAgentConnection_agentRegistryId_unique" UNIQUE("agentRegistryId"),
	CONSTRAINT "ExternalAgentConnection_externalId_unique" UNIQUE("externalId")
);
--> statement-breakpoint
CREATE TABLE "Market" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"gameId" text,
	"dayNumber" integer,
	"yesShares" numeric(18, 6) DEFAULT '0' NOT NULL,
	"noShares" numeric(18, 6) DEFAULT '0' NOT NULL,
	"liquidity" numeric(18, 6) NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolution" boolean,
	"endDate" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"resolutionProofUrl" text,
	"resolutionDescription" text
);
--> statement-breakpoint
CREATE TABLE "Organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ticker" text,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"canBeInvolved" boolean DEFAULT true NOT NULL,
	"initialPrice" double precision,
	"currentPrice" double precision,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"imageUrl" text
);
--> statement-breakpoint
CREATE TABLE "PerpMarketSnapshot" (
	"ticker" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"name" text,
	"currentPrice" double precision NOT NULL,
	"price24hAgo" double precision,
	"price24hAgoUpdatedAt" timestamp,
	"metrics24hResetAt" timestamp,
	"change24h" double precision DEFAULT 0 NOT NULL,
	"changePercent24h" double precision DEFAULT 0 NOT NULL,
	"high24h" double precision NOT NULL,
	"low24h" double precision NOT NULL,
	"volume24h" double precision DEFAULT 0 NOT NULL,
	"openInterest" double precision DEFAULT 0 NOT NULL,
	"fundingRate" jsonb NOT NULL,
	"maxLeverage" integer DEFAULT 100 NOT NULL,
	"minOrderSize" integer DEFAULT 10 NOT NULL,
	"bidPrice" double precision,
	"askPrice" double precision,
	"spreadBps" double precision,
	"bidDepth" double precision,
	"askDepth" double precision,
	"liquidityRegime" text,
	"quoteUpdatedAt" timestamp,
	"markPrice" double precision,
	"indexPrice" double precision,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PerpPosition" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ticker" text NOT NULL,
	"organizationId" text NOT NULL,
	"side" text NOT NULL,
	"entryPrice" double precision NOT NULL,
	"currentPrice" double precision NOT NULL,
	"size" double precision NOT NULL,
	"leverage" integer NOT NULL,
	"liquidationPrice" double precision NOT NULL,
	"unrealizedPnL" double precision NOT NULL,
	"unrealizedPnLPercent" double precision NOT NULL,
	"fundingPaid" double precision DEFAULT 0 NOT NULL,
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"lastUpdated" timestamp NOT NULL,
	"closedAt" timestamp,
	"realizedPnL" double precision,
	"settledAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "Position" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"marketId" text NOT NULL,
	"side" boolean NOT NULL,
	"shares" numeric(18, 6) NOT NULL,
	"avgPrice" numeric(18, 6) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"outcome" boolean,
	"pnl" numeric(18, 2),
	"questionId" integer,
	"resolvedAt" timestamp,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PredictionPriceHistory" (
	"id" text PRIMARY KEY NOT NULL,
	"marketId" text NOT NULL,
	"yesPrice" double precision NOT NULL,
	"noPrice" double precision NOT NULL,
	"yesShares" numeric(24, 8) NOT NULL,
	"noShares" numeric(24, 8) NOT NULL,
	"liquidity" numeric(24, 8) NOT NULL,
	"eventType" text NOT NULL,
	"source" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Question" (
	"id" text PRIMARY KEY NOT NULL,
	"questionNumber" integer NOT NULL,
	"marketId" text,
	"text" text NOT NULL,
	"scenarioId" integer NOT NULL,
	"outcome" boolean NOT NULL,
	"rank" integer NOT NULL,
	"createdDate" timestamp DEFAULT now() NOT NULL,
	"resolutionDate" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"topicKey" text,
	"topicLabel" text,
	"topicDate" timestamp,
	"resolvedOutcome" boolean,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"resolutionProofUrl" text,
	"resolutionDescription" text,
	"resolutionConfidence" double precision,
	"requiresManualReview" boolean DEFAULT false NOT NULL,
	"resolutionReviewStatus" text,
	"resolutionReviewedAt" timestamp,
	"resolutionReviewedBy" text,
	CONSTRAINT "Question_questionNumber_unique" UNIQUE("questionNumber")
);
--> statement-breakpoint
CREATE TABLE "StockPrice" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"price" double precision NOT NULL,
	"change" double precision NOT NULL,
	"changePercent" double precision NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"isSnapshot" boolean DEFAULT false NOT NULL,
	"openPrice" double precision,
	"highPrice" double precision,
	"lowPrice" double precision,
	"volume" double precision
);
--> statement-breakpoint
CREATE TABLE "ChatParticipant" (
	"id" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"userId" text NOT NULL,
	"joinedAt" timestamp DEFAULT now() NOT NULL,
	"invitedBy" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"addedBy" text,
	CONSTRAINT "ChatParticipant_chatId_userId_key" UNIQUE("chatId","userId")
);
--> statement-breakpoint
CREATE TABLE "Chat" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"description" text,
	"isGroup" boolean DEFAULT false NOT NULL,
	"createdBy" text,
	"gameId" text,
	"dayNumber" integer,
	"relatedQuestion" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"groupId" text,
	"requiredNftContractAddress" text,
	"requiredNftTokenId" integer,
	"requiredNftChainId" integer,
	"nftGated" boolean DEFAULT false NOT NULL,
	"lastNftRevalidatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "DMAcceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"userId" text NOT NULL,
	"otherUserId" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"acceptedAt" timestamp,
	"rejectedAt" timestamp,
	CONSTRAINT "DMAcceptance_chatId_unique" UNIQUE("chatId")
);
--> statement-breakpoint
CREATE TABLE "GroupInvite" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"invitedUserId" text NOT NULL,
	"invitedBy" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"invitedAt" timestamp DEFAULT now() NOT NULL,
	"respondedAt" timestamp,
	"declineCount" integer DEFAULT 0 NOT NULL,
	"lastDeclinedAt" timestamp,
	"nextEligibleAt" timestamp,
	CONSTRAINT "GroupInvite_groupId_invitedUserId_key" UNIQUE("groupId","invitedUserId")
);
--> statement-breakpoint
CREATE TABLE "GroupMember" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joinedAt" timestamp DEFAULT now() NOT NULL,
	"addedBy" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastMessageAt" timestamp,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"qualityScore" double precision DEFAULT 1 NOT NULL,
	"kickedAt" timestamp,
	"kickReason" text,
	"tier" integer,
	"promotedAt" timestamp,
	"demotedAt" timestamp,
	"previousTier" integer,
	"isGrandfathered" boolean DEFAULT false NOT NULL,
	"grandfatheredAt" timestamp,
	CONSTRAINT "GroupMember_groupId_userId_key" UNIQUE("groupId","userId")
);
--> statement-breakpoint
CREATE TABLE "Group" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "group_type" NOT NULL,
	"ownerId" text NOT NULL,
	"createdById" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"tier" integer,
	"maxMembers" integer,
	"parentGroupId" text,
	"activeChatId" text
);
--> statement-breakpoint
CREATE TABLE "MessageReaction" (
	"id" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"messageId" text NOT NULL,
	"userId" text NOT NULL,
	"emoji" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "MessageReaction_messageId_userId_emoji_key" UNIQUE("messageId","userId","emoji")
);
--> statement-breakpoint
CREATE TABLE "Message" (
	"id" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL,
	"senderId" text NOT NULL,
	"content" text NOT NULL,
	"type" "message_type" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"targetIds" text[],
	"metadata" jsonb,
	"replyToMessageId" text
);
--> statement-breakpoint
CREATE TABLE "Notification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"dedupeKey" text,
	"type" text NOT NULL,
	"actorId" text,
	"postId" text,
	"commentId" text,
	"chatId" text,
	"message" text NOT NULL,
	"data" jsonb,
	"read" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"groupId" text,
	"inviteId" text
);
--> statement-breakpoint
CREATE TABLE "AdminAuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"adminId" text NOT NULL,
	"action" text NOT NULL,
	"resourceType" text NOT NULL,
	"resourceId" text,
	"previousValue" json,
	"newValue" json,
	"ipAddress" text,
	"userAgent" text,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AnalyticsDailySnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp NOT NULL,
	"totalUsers" integer DEFAULT 0 NOT NULL,
	"newUsers" integer DEFAULT 0 NOT NULL,
	"activeUsers" integer DEFAULT 0 NOT NULL,
	"bannedUsers" integer DEFAULT 0 NOT NULL,
	"totalPosts" integer DEFAULT 0 NOT NULL,
	"newPosts" integer DEFAULT 0 NOT NULL,
	"totalComments" integer DEFAULT 0 NOT NULL,
	"newComments" integer DEFAULT 0 NOT NULL,
	"totalReactions" integer DEFAULT 0 NOT NULL,
	"newReactions" integer DEFAULT 0 NOT NULL,
	"totalMarkets" integer DEFAULT 0 NOT NULL,
	"activeMarkets" integer DEFAULT 0 NOT NULL,
	"totalTrades" integer DEFAULT 0 NOT NULL,
	"newTrades" integer DEFAULT 0 NOT NULL,
	"totalFollows" integer DEFAULT 0 NOT NULL,
	"newFollows" integer DEFAULT 0 NOT NULL,
	"totalReferrals" integer DEFAULT 0 NOT NULL,
	"newReferrals" integer DEFAULT 0 NOT NULL,
	"totalReports" integer DEFAULT 0 NOT NULL,
	"newReports" integer DEFAULT 0 NOT NULL,
	"resolvedReports" integer DEFAULT 0 NOT NULL,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "AnalyticsDailySnapshot_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "DailyTopic" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp NOT NULL,
	"topicKey" text NOT NULL,
	"topicLabel" text NOT NULL,
	"summary" text NOT NULL,
	"sourceType" text NOT NULL,
	"sourceHeadlineIds" json NOT NULL,
	"selectionReason" text,
	"isLocked" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "DailyTopic_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "GameConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" json NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "GameConfig_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "Game" (
	"id" text PRIMARY KEY NOT NULL,
	"currentDay" integer DEFAULT 1 NOT NULL,
	"currentDate" timestamp DEFAULT now() NOT NULL,
	"isRunning" boolean DEFAULT false NOT NULL,
	"isContinuous" boolean DEFAULT true NOT NULL,
	"speed" integer DEFAULT 60000 NOT NULL,
	"startedAt" timestamp,
	"pausedAt" timestamp,
	"completedAt" timestamp,
	"lastTickAt" timestamp,
	"lastSnapshotAt" timestamp,
	"activeQuestions" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GenerationLock" (
	"id" text PRIMARY KEY DEFAULT 'game-tick-lock' NOT NULL,
	"lockedBy" text NOT NULL,
	"lockedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"operation" text DEFAULT 'game-tick' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OAuthState" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"codeVerifier" text NOT NULL,
	"userId" text,
	"returnPath" text,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "OAuthState_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "ParodyHeadline" (
	"id" text PRIMARY KEY NOT NULL,
	"originalHeadlineId" text NOT NULL,
	"originalTitle" text NOT NULL,
	"originalSource" text NOT NULL,
	"parodyTitle" text NOT NULL,
	"parodyContent" text,
	"characterMappings" json NOT NULL,
	"organizationMappings" json NOT NULL,
	"generatedAt" timestamp NOT NULL,
	"isUsed" boolean DEFAULT false NOT NULL,
	"usedAt" timestamp,
	"qualityScore" double precision,
	"qualityReasons" json,
	"generationDepth" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ParodyHeadline_originalHeadlineId_unique" UNIQUE("originalHeadlineId")
);
--> statement-breakpoint
CREATE TABLE "RealtimeOutbox" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"version" text DEFAULT 'v1',
	"payload" json NOT NULL,
	"status" "RealtimeOutboxStatus" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RSSFeedSource" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"feedUrl" text NOT NULL,
	"category" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastFetched" timestamp,
	"fetchErrors" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RSSHeadline" (
	"id" text PRIMARY KEY NOT NULL,
	"sourceId" text NOT NULL,
	"title" text NOT NULL,
	"link" text,
	"publishedAt" timestamp NOT NULL,
	"summary" text,
	"content" text,
	"rawData" json,
	"fetchedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SentryIncidentAlertOutbox" (
	"id" text PRIMARY KEY NOT NULL,
	"runId" text,
	"inboxId" text NOT NULL,
	"sentryIssueKey" text NOT NULL,
	"eventType" text NOT NULL,
	"dedupeKey" text NOT NULL,
	"payload" json NOT NULL,
	"status" "SentryIncidentAlertOutboxStatus" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 8 NOT NULL,
	"nextAttemptAt" timestamp DEFAULT now() NOT NULL,
	"processingStartedAt" timestamp,
	"sentAt" timestamp,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "SentryIncidentAlertOutbox_dedupeKey_unique" UNIQUE("dedupeKey")
);
--> statement-breakpoint
CREATE TABLE "SentryIncidentDiscordThread" (
	"id" text PRIMARY KEY NOT NULL,
	"sentryIssueKey" text NOT NULL,
	"channelId" text NOT NULL,
	"rootMessageId" text NOT NULL,
	"threadId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "SentryIncidentDiscordThread_sentryIssueKey_unique" UNIQUE("sentryIssueKey"),
	CONSTRAINT "SentryIncidentDiscordThread_threadId_unique" UNIQUE("threadId")
);
--> statement-breakpoint
CREATE TABLE "SentryIncidentRun" (
	"id" text PRIMARY KEY NOT NULL,
	"inboxId" text NOT NULL,
	"sentryIssueKey" text NOT NULL,
	"issueId" text,
	"issueShortId" text,
	"action" text,
	"workerId" text NOT NULL,
	"status" "SentryIncidentRunStatus" DEFAULT 'running' NOT NULL,
	"decision" "SentryIncidentRunDecision" DEFAULT 'pending' NOT NULL,
	"linearIssueId" text,
	"linearIssueUrl" text,
	"codexSessionId" text,
	"summary" text,
	"resultReason" text,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SentryWebhookInbox" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'sentry' NOT NULL,
	"resource" text NOT NULL,
	"action" text,
	"organizationSlug" text,
	"projectSlug" text,
	"issueId" text,
	"issueShortId" text,
	"issueTitle" text,
	"issueUrl" text,
	"eventId" text,
	"level" text,
	"culprit" text,
	"dedupeKey" text NOT NULL,
	"routingKey" text,
	"webhookTimestamp" timestamp,
	"status" "SentryWebhookInboxStatus" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 8 NOT NULL,
	"nextAttemptAt" timestamp DEFAULT now() NOT NULL,
	"processingStartedAt" timestamp,
	"processedAt" timestamp,
	"failedAt" timestamp,
	"lastError" text,
	"payload" json NOT NULL,
	"metadata" json,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "SentryWebhookInbox_dedupeKey_unique" UNIQUE("dedupeKey")
);
--> statement-breakpoint
CREATE TABLE "SystemSettings" (
	"id" text PRIMARY KEY DEFAULT 'system' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TickTokenStats" (
	"id" text PRIMARY KEY NOT NULL,
	"tickId" text NOT NULL,
	"tickStartedAt" timestamp NOT NULL,
	"tickCompletedAt" timestamp NOT NULL,
	"tickDurationMs" integer NOT NULL,
	"totalCalls" integer NOT NULL,
	"totalInputTokens" integer NOT NULL,
	"totalOutputTokens" integer NOT NULL,
	"totalTokens" integer NOT NULL,
	"byPromptType" json NOT NULL,
	"byModel" json NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WidgetCache" (
	"widget" text PRIMARY KEY NOT NULL,
	"data" json NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WorldEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"eventType" text NOT NULL,
	"description" text NOT NULL,
	"actors" text[] DEFAULT '{}' NOT NULL,
	"relatedQuestion" integer,
	"pointsToward" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"gameId" text,
	"dayNumber" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WorldFact" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"source" text,
	"lastUpdated" timestamp NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"qualityScore" double precision,
	"generationDepth" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_event_coverage" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"org_id" text NOT NULL,
	"status" text NOT NULL,
	"article_id" text,
	"covered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ArcState" (
	"id" text PRIMARY KEY NOT NULL,
	"questionId" text NOT NULL,
	"currentState" text NOT NULL,
	"stateEnteredAt" timestamp NOT NULL,
	"eventsGenerated" integer DEFAULT 0 NOT NULL,
	"lastEventAt" timestamp,
	"pendingTransitions" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ArcState_questionId_unique" UNIQUE("questionId")
);
--> statement-breakpoint
CREATE TABLE "QuestionArcPlan" (
	"id" text PRIMARY KEY NOT NULL,
	"questionId" text NOT NULL,
	"uncertaintyPeakDay" integer NOT NULL,
	"clarityOnsetDay" integer NOT NULL,
	"verificationDay" integer NOT NULL,
	"insiderActorIds" jsonb DEFAULT '[]'::jsonb,
	"deceiverActorIds" jsonb DEFAULT '[]'::jsonb,
	"phaseRatios" jsonb NOT NULL,
	"eventSchedule" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SubMarketSpawnLog" (
	"id" text PRIMARY KEY NOT NULL,
	"parentMarketId" text NOT NULL,
	"sourceEventId" text,
	"eventType" text NOT NULL,
	"spawnedMarketId" text,
	"wasSpawned" boolean NOT NULL,
	"skipReason" text,
	"questionTemplate" text,
	"generatedQuestion" text,
	"childTimeframe" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TimeframedMarket" (
	"id" text PRIMARY KEY NOT NULL,
	"questionId" text,
	"timeframe" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"topicKey" text,
	"topicLabel" text,
	"topicDate" timestamp,
	"granularTimeframe" text,
	"parentMarketId" text,
	"rootMarketId" text,
	"startTime" timestamp NOT NULL,
	"endTime" timestamp NOT NULL,
	"arcState" text DEFAULT 'setup' NOT NULL,
	"arcStateEnteredAt" timestamp NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"isResolved" boolean DEFAULT false NOT NULL,
	"resolvedAt" timestamp,
	"triggerData" jsonb,
	"affiliatedOrgIds" jsonb DEFAULT '[]'::jsonb,
	"affiliatedActorIds" jsonb DEFAULT '[]'::jsonb,
	"childMarketCount" integer DEFAULT 0 NOT NULL,
	"eventsGenerated" integer DEFAULT 0 NOT NULL,
	"lastEventAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "NftClaim" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenId" integer NOT NULL,
	"claimerUserId" text,
	"claimerAddress" text NOT NULL,
	"claimedAt" timestamp NOT NULL,
	"txHash" text NOT NULL,
	"snapshotRank" integer,
	"snapshotPoints" integer,
	CONSTRAINT "NftClaim_tokenId_key" UNIQUE("tokenId")
);
--> statement-breakpoint
CREATE TABLE "NftCollection" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"imageUrl" text NOT NULL,
	"thumbnailUrl" text,
	"imageCid" text,
	"storyTitle" text,
	"storyContent" text,
	"metadataUri" text,
	"attributes" json,
	"contractAddress" text NOT NULL,
	"chainId" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "NftCollection_tokenId_unique" UNIQUE("tokenId")
);
--> statement-breakpoint
CREATE TABLE "NftOwnership" (
	"id" text PRIMARY KEY NOT NULL,
	"tokenId" integer NOT NULL,
	"ownerAddress" text NOT NULL,
	"userId" text,
	"acquiredAt" timestamp NOT NULL,
	"txHash" text,
	"blockNumber" bigint,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "NftOwnership_tokenId_key" UNIQUE("tokenId")
);
--> statement-breakpoint
CREATE TABLE "NftSnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"walletAddress" text,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"snapshotTakenAt" timestamp NOT NULL,
	"hasMinted" boolean DEFAULT false NOT NULL,
	"mintedTokenId" integer,
	"mintedAt" timestamp,
	"mintTxHash" text,
	CONSTRAINT "NftSnapshot_userId_key" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "OrganizationState" (
	"id" text PRIMARY KEY NOT NULL,
	"currentPrice" double precision,
	"basePrice" double precision DEFAULT 100 NOT NULL,
	"sentiment" integer DEFAULT 0 NOT NULL,
	"activeModifiers" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "sentiment_range" CHECK ("OrganizationState"."sentiment" >= -100 AND "OrganizationState"."sentiment" <= 100)
);
--> statement-breakpoint
CREATE TABLE "PoolDeposit" (
	"id" text PRIMARY KEY NOT NULL,
	"poolId" text NOT NULL,
	"userId" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"shares" numeric(18, 6) NOT NULL,
	"currentValue" numeric(18, 2) NOT NULL,
	"unrealizedPnL" numeric(18, 2) NOT NULL,
	"depositedAt" timestamp DEFAULT now() NOT NULL,
	"withdrawnAt" timestamp,
	"withdrawnAmount" numeric(18, 2)
);
--> statement-breakpoint
CREATE TABLE "PoolPosition" (
	"id" text PRIMARY KEY NOT NULL,
	"poolId" text NOT NULL,
	"marketType" text NOT NULL,
	"ticker" text,
	"marketId" text,
	"side" text NOT NULL,
	"entryPrice" double precision NOT NULL,
	"currentPrice" double precision NOT NULL,
	"size" double precision NOT NULL,
	"shares" double precision,
	"leverage" integer,
	"liquidationPrice" double precision,
	"unrealizedPnL" double precision NOT NULL,
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp,
	"realizedPnL" double precision,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Pool" (
	"id" text PRIMARY KEY NOT NULL,
	"npcActorId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"totalValue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"totalDeposits" numeric(18, 2) DEFAULT '0' NOT NULL,
	"availableBalance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"lifetimePnL" numeric(18, 2) DEFAULT '0' NOT NULL,
	"performanceFeeRate" double precision DEFAULT 0.05 NOT NULL,
	"totalFeesCollected" numeric(18, 2) DEFAULT '0' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"closedAt" timestamp,
	"updatedAt" timestamp NOT NULL,
	"currentPrice" double precision,
	"priceChange24h" double precision,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"tvl" numeric(18, 2),
	"volume24h" numeric(18, 2)
);
--> statement-breakpoint
CREATE TABLE "Comment" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"postId" text NOT NULL,
	"authorId" text NOT NULL,
	"parentCommentId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "FeedEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"surface" text NOT NULL,
	"actionType" text NOT NULL,
	"itemId" text NOT NULL,
	"itemType" text NOT NULL,
	"clusterId" text,
	"marketId" text,
	"topicKey" text,
	"authorId" text,
	"feedPosition" integer,
	"dwellMs" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PostTag" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"tagId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "PostTag_postId_tagId_key" UNIQUE("postId","tagId")
);
--> statement-breakpoint
CREATE TABLE "Post" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"authorId" text NOT NULL,
	"gameId" text,
	"dayNumber" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"articleTitle" text,
	"biasScore" double precision,
	"byline" text,
	"category" text,
	"fullContent" text,
	"sentiment" text,
	"slant" text,
	"imageUrl" text,
	"type" text DEFAULT 'post' NOT NULL,
	"deletedAt" timestamp,
	"commentOnPostId" text,
	"parentCommentId" text,
	"originalPostId" text,
	"relatedQuestion" integer
);
--> statement-breakpoint
CREATE TABLE "Reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text,
	"commentId" text,
	"userId" text NOT NULL,
	"type" text DEFAULT 'like' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Reaction_commentId_userId_type_key" UNIQUE("commentId","userId","type"),
	CONSTRAINT "Reaction_postId_userId_type_key" UNIQUE("postId","userId","type")
);
--> statement-breakpoint
CREATE TABLE "ShareAction" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"platform" text NOT NULL,
	"contentType" text NOT NULL,
	"contentId" text,
	"url" text,
	"pointsAwarded" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"verificationDetails" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verifiedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "Share" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"postId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Share_userId_postId_key" UNIQUE("userId","postId")
);
--> statement-breakpoint
CREATE TABLE "Tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"displayName" text NOT NULL,
	"category" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "Tag_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "TrendingTag" (
	"id" text PRIMARY KEY NOT NULL,
	"tagId" text NOT NULL,
	"score" double precision NOT NULL,
	"postCount" integer NOT NULL,
	"rank" integer NOT NULL,
	"calculatedAt" timestamp DEFAULT now() NOT NULL,
	"windowStart" timestamp NOT NULL,
	"windowEnd" timestamp NOT NULL,
	"relatedContext" text
);
--> statement-breakpoint
CREATE TABLE "ScamBenchSession" (
	"id" text PRIMARY KEY NOT NULL,
	"participantId" text NOT NULL,
	"userId" text,
	"source" text DEFAULT 'web' NOT NULL,
	"mturkAssignmentId" text,
	"mturkHitId" text,
	"mturkWorkerId" text,
	"scenarioCount" integer NOT NULL,
	"overallAccuracy" double precision NOT NULL,
	"attackAccuracy" double precision NOT NULL,
	"legitimateAccuracy" double precision NOT NULL,
	"avgReadTimeMs" double precision NOT NULL,
	"avgResponseTimeMs" double precision NOT NULL,
	"totalDurationMs" double precision,
	"responses" json NOT NULL,
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TradeAttempt" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tradeType" text NOT NULL,
	"marketId" text,
	"ticker" text,
	"amount" text NOT NULL,
	"outcome" text NOT NULL,
	"failureReason" text,
	"failureCode" text,
	"durationMs" integer,
	"requestId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserActivityLog" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"activityType" text NOT NULL,
	"activityDate" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserActivityLog_userId_activityDate_activityType_idx" UNIQUE("userId","activityDate","activityType")
);
--> statement-breakpoint
CREATE TABLE "UserSession" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"sessionId" text NOT NULL,
	"startedAt" timestamp NOT NULL,
	"lastActiveAt" timestamp NOT NULL,
	"endedAt" timestamp,
	"deviceType" text,
	"userAgent" text,
	"ipHash" text,
	"pageCount" integer DEFAULT 0 NOT NULL,
	"heartbeatCount" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BalanceTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balanceBefore" numeric(18, 2) NOT NULL,
	"balanceAfter" numeric(18, 2) NOT NULL,
	"relatedId" text,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"fromUserId" text,
	"fromAgentId" text,
	"toUserId" text,
	"toAgentId" text,
	"score" integer NOT NULL,
	"rating" integer,
	"comment" text,
	"category" text,
	"gameId" text,
	"tradeId" text,
	"positionId" text,
	"interactionType" text NOT NULL,
	"onChainTxHash" text,
	"agent0TokenId" integer,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ModerationEscrow" (
	"id" text PRIMARY KEY NOT NULL,
	"recipientId" text NOT NULL,
	"adminId" text NOT NULL,
	"amountUSD" numeric(18, 2) NOT NULL,
	"amountWei" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"paymentRequestId" text,
	"paymentTxHash" text,
	"refundTxHash" text,
	"refundedBy" text,
	"refundedAt" timestamp,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "ModerationEscrow_paymentRequestId_unique" UNIQUE("paymentRequestId"),
	CONSTRAINT "ModerationEscrow_paymentTxHash_unique" UNIQUE("paymentTxHash"),
	CONSTRAINT "ModerationEscrow_refundTxHash_unique" UNIQUE("refundTxHash")
);
--> statement-breakpoint
CREATE TABLE "PointsTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"amount" integer NOT NULL,
	"pointsBefore" integer NOT NULL,
	"pointsAfter" integer NOT NULL,
	"reason" text NOT NULL,
	"metadata" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"paymentAmount" text,
	"paymentRequestId" text,
	"paymentTxHash" text,
	"paymentVerified" boolean DEFAULT false NOT NULL,
	"paymentProvider" text,
	CONSTRAINT "PointsTransaction_paymentRequestId_unique" UNIQUE("paymentRequestId")
);
--> statement-breakpoint
CREATE TABLE "Report" (
	"id" text PRIMARY KEY NOT NULL,
	"reporterId" text NOT NULL,
	"reportedUserId" text,
	"reportedPostId" text,
	"reportedCommentId" text,
	"reportType" text NOT NULL,
	"category" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"resolution" text,
	"resolvedBy" text,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TradingFeeOutbox" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tradeType" text NOT NULL,
	"tradeAmount" numeric(24, 8) NOT NULL,
	"tradeId" text,
	"marketId" text,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TradingFee" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tradeType" text NOT NULL,
	"tradeId" text,
	"marketId" text,
	"feeAmount" numeric(18, 2) NOT NULL,
	"platformFee" numeric(18, 2) NOT NULL,
	"referrerFee" numeric(18, 2) NOT NULL,
	"referrerId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_results" (
	"id" text PRIMARY KEY NOT NULL,
	"modelId" text NOT NULL,
	"benchmarkId" text NOT NULL,
	"benchmarkPath" text NOT NULL,
	"runAt" timestamp DEFAULT now() NOT NULL,
	"totalPnl" double precision NOT NULL,
	"predictionAccuracy" double precision NOT NULL,
	"perpWinRate" double precision NOT NULL,
	"optimalityScore" double precision NOT NULL,
	"detailedMetrics" json NOT NULL,
	"baselinePnlDelta" double precision,
	"baselineAccuracyDelta" double precision,
	"improved" boolean,
	"duration" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_call_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"trajectoryId" text NOT NULL,
	"stepId" text NOT NULL,
	"callId" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"latencyMs" integer,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"actionType" text,
	"systemPrompt" text NOT NULL,
	"userPrompt" text NOT NULL,
	"messagesJson" text,
	"response" text NOT NULL,
	"reasoning" text,
	"temperature" double precision NOT NULL,
	"maxTokens" integer NOT NULL,
	"topP" double precision,
	"promptTokens" integer,
	"completionTokens" integer,
	"totalTokens" integer,
	"metadata" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_call_logs_callId_unique" UNIQUE("callId")
);
--> statement-breakpoint
CREATE TABLE "market_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"windowId" varchar(50) NOT NULL,
	"stockTicker" varchar(20),
	"startPrice" numeric(10, 2),
	"endPrice" numeric(10, 2),
	"changePercent" numeric(5, 2),
	"sentiment" varchar(20),
	"newsEvents" json,
	"predictionMarketId" text,
	"question" text,
	"outcome" varchar(20),
	"finalProbability" numeric(5, 4),
	"volume" numeric(15, 2),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction_trajectories" (
	"id" text PRIMARY KEY NOT NULL,
	"eventId" text NOT NULL,
	"eventType" text NOT NULL,
	"eventSeverity" integer NOT NULL,
	"npcId" text NOT NULL,
	"npcRole" text NOT NULL,
	"arcPhase" text,
	"orgContextJson" text,
	"actionType" text NOT NULL,
	"actionAngle" text,
	"actionSentiment" text,
	"postId" text,
	"tradeDetailsJson" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"outcomeRecordedAt" timestamp,
	"outcomeLikes" integer,
	"outcomeComments" integer,
	"outcomeReposts" integer,
	"outcomePriceMovement" numeric(10, 4),
	"outcomeProfitLoss" numeric(18, 2),
	"outcomeOtherNpcs" integer,
	"outcomeHumans" integer,
	"reward" numeric(8, 4),
	"usedInTraining" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "reward_judgments" (
	"id" text PRIMARY KEY NOT NULL,
	"trajectoryId" text NOT NULL,
	"judgeModel" text NOT NULL,
	"judgeVersion" text NOT NULL,
	"overallScore" double precision NOT NULL,
	"componentScoresJson" text,
	"rank" integer,
	"normalizedScore" double precision,
	"groupId" text,
	"reasoning" text NOT NULL,
	"strengthsJson" text,
	"weaknessesJson" text,
	"criteriaJson" text NOT NULL,
	"judgedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reward_judgments_trajectoryId_unique" UNIQUE("trajectoryId")
);
--> statement-breakpoint
CREATE TABLE "trained_models" (
	"id" text PRIMARY KEY NOT NULL,
	"modelId" text NOT NULL,
	"version" text NOT NULL,
	"baseModel" text NOT NULL,
	"trainingBatch" text,
	"status" text DEFAULT 'training' NOT NULL,
	"deployedAt" timestamp,
	"archivedAt" timestamp,
	"storagePath" text NOT NULL,
	"benchmarkScore" double precision,
	"accuracy" double precision,
	"avgReward" double precision,
	"evalMetrics" json,
	"wandbRunId" text,
	"wandbArtifactId" text,
	"huggingFaceRepo" text,
	"agentsUsing" integer DEFAULT 0 NOT NULL,
	"totalInferences" integer DEFAULT 0 NOT NULL,
	"lastBenchmarked" timestamp,
	"benchmarkCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "trained_models_modelId_unique" UNIQUE("modelId")
);
--> statement-breakpoint
CREATE TABLE "training_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"batchId" text NOT NULL,
	"scenarioId" text,
	"baseModel" text NOT NULL,
	"modelVersion" text NOT NULL,
	"trajectoryIds" text NOT NULL,
	"rankingsJson" text,
	"rewardsJson" text NOT NULL,
	"trainingLoss" double precision,
	"policyImprovement" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"startedAt" timestamp,
	"completedAt" timestamp,
	CONSTRAINT "training_batches_batchId_unique" UNIQUE("batchId")
);
--> statement-breakpoint
CREATE TABLE "trajectories" (
	"id" text PRIMARY KEY NOT NULL,
	"trajectoryId" text NOT NULL,
	"agentId" text NOT NULL,
	"archetype" varchar(50),
	"startTime" timestamp NOT NULL,
	"endTime" timestamp NOT NULL,
	"durationMs" integer NOT NULL,
	"windowId" varchar(50),
	"windowHours" integer DEFAULT 1 NOT NULL,
	"episodeId" varchar(100),
	"scenarioId" varchar(100),
	"batchId" varchar(100),
	"stepsJson" text NOT NULL,
	"rewardComponentsJson" text NOT NULL,
	"metricsJson" text NOT NULL,
	"metadataJson" text NOT NULL,
	"totalReward" double precision NOT NULL,
	"episodeLength" integer NOT NULL,
	"finalStatus" text NOT NULL,
	"finalBalance" double precision,
	"finalPnL" double precision,
	"tradesExecuted" integer,
	"postsCreated" integer,
	"aiJudgeReward" double precision,
	"aiJudgeReasoning" text,
	"judgedAt" timestamp,
	"isTrainingData" boolean DEFAULT true NOT NULL,
	"isEvaluation" boolean DEFAULT false NOT NULL,
	"usedInTraining" boolean DEFAULT false NOT NULL,
	"trainedInBatch" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"worldStateSnapshotId" text,
	"packId" text,
	"npcRole" varchar(20),
	"questionIds" text,
	"eventIds" text,
	"arcPhase" varchar(20),
	"memorySnapshotJson" text,
	"relationshipSnapshotJson" text,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "trajectories_trajectoryId_unique" UNIQUE("trajectoryId")
);
--> statement-breakpoint
CREATE TABLE "WorldStateSnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"windowId" varchar(50) NOT NULL,
	"packId" text,
	"gameDay" integer NOT NULL,
	"gameTime" timestamp NOT NULL,
	"predictionMarketsJson" text,
	"perpMarketsJson" text,
	"worldEventsJson" text,
	"activeStoriesJson" text,
	"insiderAssignmentsJson" text,
	"arcPhase" varchar(20),
	"arcPlanJson" text,
	"orgStatesJson" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserAgentConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"personality" text,
	"system" text,
	"tradingStrategy" text,
	"style" json,
	"messageExamples" json,
	"personaPrompt" text,
	"goals" json,
	"directives" json,
	"constraints" json,
	"priceAlerts" json DEFAULT '[]'::json,
	"alignment" text DEFAULT 'neutral' NOT NULL,
	"team" text DEFAULT 'gray' NOT NULL,
	"planningHorizon" text DEFAULT 'single' NOT NULL,
	"riskTolerance" text DEFAULT 'medium' NOT NULL,
	"maxActionsPerTick" integer DEFAULT 3 NOT NULL,
	"modelTier" text DEFAULT 'free' NOT NULL,
	"autonomousPosting" boolean DEFAULT false NOT NULL,
	"autonomousCommenting" boolean DEFAULT false NOT NULL,
	"autonomousTrading" boolean DEFAULT true NOT NULL,
	"autonomousDMs" boolean DEFAULT false NOT NULL,
	"autonomousGroupChats" boolean DEFAULT false NOT NULL,
	"autonomousTransfers" boolean DEFAULT false NOT NULL,
	"a2aEnabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"errorMessage" text,
	"lastTickAt" timestamp,
	"lastChatAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "UserAgentConfig_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "Favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"targetUserId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Favorite_userId_targetUserId_key" UNIQUE("userId","targetUserId")
);
--> statement-breakpoint
CREATE TABLE "FollowStatus" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"npcId" text NOT NULL,
	"followedAt" timestamp DEFAULT now() NOT NULL,
	"unfollowedAt" timestamp,
	"isActive" boolean DEFAULT true NOT NULL,
	"followReason" text,
	CONSTRAINT "FollowStatus_userId_npcId_key" UNIQUE("userId","npcId")
);
--> statement-breakpoint
CREATE TABLE "Follow" (
	"id" text PRIMARY KEY NOT NULL,
	"followerId" text NOT NULL,
	"followingId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Follow_followerId_followingId_key" UNIQUE("followerId","followingId")
);
--> statement-breakpoint
CREATE TABLE "GameOnboarding" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"currentStep" text DEFAULT 'welcome' NOT NULL,
	"state" jsonb DEFAULT '{"completedSteps":[],"currentStep":"welcome","startedAt":null,"completedAt":null,"rewards":[]}'::jsonb,
	"isComplete" boolean DEFAULT false NOT NULL,
	"skippedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "GameOnboarding_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "OnboardingIntent" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"status" "OnboardingStatus" DEFAULT 'PENDING_PROFILE' NOT NULL,
	"referralCode" text,
	"payload" json,
	"profileApplied" boolean DEFAULT false NOT NULL,
	"profileCompletedAt" timestamp,
	"onchainStartedAt" timestamp,
	"onchainCompletedAt" timestamp,
	"lastError" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "OnboardingIntent_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "ProfileUpdateLog" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"changedFields" text[] NOT NULL,
	"backendSigned" boolean NOT NULL,
	"txHash" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Referral" (
	"id" text PRIMARY KEY NOT NULL,
	"referrerId" text NOT NULL,
	"referredUserId" text,
	"referralCode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"qualifiedAt" timestamp,
	"signupPointsAwarded" boolean DEFAULT false NOT NULL,
	"suspiciousReferralFlags" json,
	CONSTRAINT "Referral_referralCode_referredUserId_key" UNIQUE("referralCode","referredUserId")
);
--> statement-breakpoint
CREATE TABLE "TwitterOAuthToken" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"oauth1Token" text NOT NULL,
	"oauth1TokenSecret" text NOT NULL,
	"screenName" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "TwitterOAuthToken_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "UserActorFollow" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"actorId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserActorFollow_userId_actorId_key" UNIQUE("userId","actorId")
);
--> statement-breakpoint
CREATE TABLE "UserApiKey" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"keyHash" text NOT NULL,
	"name" text,
	"lastUsedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"revokedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "UserBlock" (
	"id" text PRIMARY KEY NOT NULL,
	"blockerId" text NOT NULL,
	"blockedId" text NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserBlock_blockerId_blockedId_key" UNIQUE("blockerId","blockedId")
);
--> statement-breakpoint
CREATE TABLE "UserInteraction" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"npcId" text NOT NULL,
	"postId" text NOT NULL,
	"commentId" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"qualityScore" double precision DEFAULT 1 NOT NULL,
	"wasFollowed" boolean DEFAULT false NOT NULL,
	"wasInvitedToChat" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserMute" (
	"id" text PRIMARY KEY NOT NULL,
	"muterId" text NOT NULL,
	"mutedId" text NOT NULL,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserMute_muterId_mutedId_key" UNIQUE("muterId","mutedId")
);
--> statement-breakpoint
CREATE TABLE "UserPnLSnapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"snapshotAt" timestamp NOT NULL,
	"lifetimePnL" double precision DEFAULT 0 NOT NULL,
	"unrealizedPnL" double precision DEFAULT 0 NOT NULL,
	"currentPnL" double precision DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "UserPnLSnapshot_userId_snapshotAt_key" UNIQUE("userId","snapshotAt")
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"walletAddress" text,
	"username" text,
	"displayName" text,
	"bio" text,
	"profileImageUrl" text,
	"isActor" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"personality" text,
	"postStyle" text,
	"postExample" text,
	"virtualBalance" numeric(18, 2) DEFAULT '1000' NOT NULL,
	"totalDeposited" numeric(18, 2) DEFAULT '1000' NOT NULL,
	"totalWithdrawn" numeric(18, 2) DEFAULT '0' NOT NULL,
	"lifetimePnL" numeric(18, 2) DEFAULT '0' NOT NULL,
	"profileComplete" boolean DEFAULT false NOT NULL,
	"hasProfileImage" boolean DEFAULT false NOT NULL,
	"hasUsername" boolean DEFAULT false NOT NULL,
	"hasBio" boolean DEFAULT false NOT NULL,
	"profileSetupCompletedAt" timestamp,
	"farcasterUsername" text,
	"hasFarcaster" boolean DEFAULT false NOT NULL,
	"hasTwitter" boolean DEFAULT false NOT NULL,
	"hasDiscord" boolean DEFAULT false NOT NULL,
	"hasTelegram" boolean DEFAULT false NOT NULL,
	"nftTokenId" integer,
	"pointsAwardedForFarcaster" boolean DEFAULT false NOT NULL,
	"pointsAwardedForFarcasterFollow" boolean DEFAULT false NOT NULL,
	"pointsAwardedForProfile" boolean DEFAULT false NOT NULL,
	"pointsAwardedForProfileImage" boolean DEFAULT false NOT NULL,
	"pointsAwardedForTwitter" boolean DEFAULT false NOT NULL,
	"pointsAwardedForTwitterFollow" boolean DEFAULT false NOT NULL,
	"pointsAwardedForDiscord" boolean DEFAULT false NOT NULL,
	"pointsAwardedForDiscordJoin" boolean DEFAULT false NOT NULL,
	"pointsAwardedForTelegram" boolean DEFAULT false NOT NULL,
	"pointsAwardedForUsername" boolean DEFAULT false NOT NULL,
	"pointsAwardedForWallet" boolean DEFAULT false NOT NULL,
	"pointsAwardedForReferralBonus" boolean DEFAULT false NOT NULL,
	"pointsAwardedForShare" boolean DEFAULT false NOT NULL,
	"pointsAwardedForPrivateGroup" boolean DEFAULT false NOT NULL,
	"pointsAwardedForPrivateChannel" boolean DEFAULT false NOT NULL,
	"referralCode" text,
	"referralCount" integer DEFAULT 0 NOT NULL,
	"referredBy" text,
	"registrationIpHash" text,
	"lastReferralIpHash" text,
	"reputationPoints" integer DEFAULT 1000 NOT NULL,
	"twitterUsername" text,
	"bannerDismissCount" integer DEFAULT 0 NOT NULL,
	"bannerLastShown" timestamp,
	"coverImageUrl" text,
	"showFarcasterPublic" boolean DEFAULT true NOT NULL,
	"showTwitterPublic" boolean DEFAULT true NOT NULL,
	"showWalletPublic" boolean DEFAULT true NOT NULL,
	"usernameChangedAt" timestamp,
	"bannedAt" timestamp,
	"bannedBy" text,
	"bannedReason" text,
	"farcasterDisplayName" text,
	"farcasterFid" text,
	"farcasterPfpUrl" text,
	"farcasterVerifiedAt" timestamp,
	"isAdmin" boolean DEFAULT false NOT NULL,
	"isBanned" boolean DEFAULT false NOT NULL,
	"isScammer" boolean DEFAULT false NOT NULL,
	"isCSAM" boolean DEFAULT false NOT NULL,
	"appealCount" integer DEFAULT 0 NOT NULL,
	"appealStaked" boolean DEFAULT false NOT NULL,
	"appealStakeAmount" numeric(18, 2),
	"appealStakeTxHash" text,
	"appealStatus" text,
	"appealSubmittedAt" timestamp,
	"appealReviewedAt" timestamp,
	"falsePositiveHistory" json,
	"privyId" text,
	"stewardId" text,
	"registrationTimestamp" timestamp,
	"role" text,
	"totalFeesEarned" numeric(18, 2) DEFAULT '0' NOT NULL,
	"totalFeesPaid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"twitterAccessToken" text,
	"twitterId" text,
	"twitterRefreshToken" text,
	"twitterTokenExpiresAt" timestamp,
	"twitterVerifiedAt" timestamp,
	"discordId" text,
	"discordUsername" text,
	"discordAccessToken" text,
	"discordRefreshToken" text,
	"discordTokenExpiresAt" timestamp,
	"discordVerifiedAt" timestamp,
	"telegramId" text,
	"telegramUsername" text,
	"telegramVerifiedAt" timestamp,
	"tosAccepted" boolean DEFAULT false NOT NULL,
	"tosAcceptedAt" timestamp,
	"tosAcceptedVersion" text DEFAULT '2025-11-11',
	"privacyPolicyAccepted" boolean DEFAULT false NOT NULL,
	"privacyPolicyAcceptedAt" timestamp,
	"privacyPolicyAcceptedVersion" text DEFAULT '2025-11-11',
	"invitePoints" integer DEFAULT 0 NOT NULL,
	"earnedPoints" integer DEFAULT 0 NOT NULL,
	"bonusPoints" integer DEFAULT 0 NOT NULL,
	"waitlistPosition" integer,
	"waitlistJoinedAt" timestamp,
	"isWaitlistActive" boolean DEFAULT false NOT NULL,
	"isTest" boolean DEFAULT false NOT NULL,
	"pointsAwardedForEmail" boolean DEFAULT false NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"email" text,
	"emailNotificationsEnabled" boolean DEFAULT false NOT NULL,
	"emailNotificationsRealtime" boolean DEFAULT true NOT NULL,
	"emailNotificationsDailySummary" boolean DEFAULT true NOT NULL,
	"emailNotificationsWeeklySummary" boolean DEFAULT true NOT NULL,
	"emailNotificationsMonthlySummary" boolean DEFAULT true NOT NULL,
	"notificationDigestEnabled" boolean DEFAULT true NOT NULL,
	"notificationDigestFrequency" text DEFAULT 'daily' NOT NULL,
	"notificationDigestDeliveryChannel" text DEFAULT 'both' NOT NULL,
	"notificationDigestLastSentAt" timestamp,
	"emailNotificationsUnsubscribedAt" timestamp,
	"waitlistGraduatedAt" timestamp,
	"isAgent" boolean DEFAULT false NOT NULL,
	"managedBy" text,
	"gameGuideCompletedAt" timestamp,
	"dailyLoginStreak" integer DEFAULT 0 NOT NULL,
	"lastDailyLogin" timestamp,
	"longestStreak" integer DEFAULT 0 NOT NULL,
	"totalDailyLogins" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "User_walletAddress_unique" UNIQUE("walletAddress"),
	CONSTRAINT "User_username_unique" UNIQUE("username"),
	CONSTRAINT "User_nftTokenId_unique" UNIQUE("nftTokenId"),
	CONSTRAINT "User_referralCode_unique" UNIQUE("referralCode"),
	CONSTRAINT "User_farcasterFid_unique" UNIQUE("farcasterFid"),
	CONSTRAINT "User_privyId_unique" UNIQUE("privyId"),
	CONSTRAINT "User_stewardId_unique" UNIQUE("stewardId"),
	CONSTRAINT "User_twitterId_unique" UNIQUE("twitterId"),
	CONSTRAINT "User_discordId_unique" UNIQUE("discordId"),
	CONSTRAINT "User_telegramId_unique" UNIQUE("telegramId")
);
--> statement-breakpoint
CREATE TABLE "WalletTransferLimit" (
	"userId" text PRIMARY KEY NOT NULL,
	"dailyLimitUsd" numeric(18, 2) DEFAULT '1000.00' NOT NULL,
	"dailySpentUsd" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"lastResetAt" timestamp DEFAULT now() NOT NULL,
	"elevatedUntil" timestamp,
	"elevatedLimitUsd" numeric(18, 2)
);
--> statement-breakpoint
CREATE TABLE "WalletTransferLog" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"fromAddress" text NOT NULL,
	"toAddress" text NOT NULL,
	"tokenAddress" text,
	"tokenId" text,
	"amount" text NOT NULL,
	"txHash" text,
	"chainId" integer NOT NULL,
	"status" text NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"confirmedAt" timestamp,
	"usdValueAtTime" numeric(18, 2),
	"ipAddress" text
);
--> statement-breakpoint
CREATE TABLE "Whitelist" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"grantedBy" text,
	"grantedAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	CONSTRAINT "Whitelist_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "WhitelistConfig" (
	"id" text PRIMARY KEY NOT NULL,
	"leaderboardRankThreshold" integer,
	"leaderboardCategory" text DEFAULT 'all' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"updatedBy" text
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"server_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"system" text DEFAULT '',
	"bio" jsonb DEFAULT '[]'::jsonb,
	"message_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adjectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plugins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache" (
	"key" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "cache_key_agent_id_pk" PRIMARY KEY("key","agent_id")
);
--> statement-breakpoint
CREATE TABLE "channel_participants" (
	"channel_id" text NOT NULL,
	"entity_id" text NOT NULL,
	CONSTRAINT "channel_participants_channel_id_entity_id_pk" PRIMARY KEY("channel_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"message_server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"source_type" text,
	"source_id" text,
	"topic" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"world_id" uuid,
	"source_entity_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"names" text[] DEFAULT '{}'::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "id_agent_id_unique" UNIQUE("id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"type" text NOT NULL,
	"room_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"content" jsonb NOT NULL,
	"entity_id" uuid,
	"agent_id" uuid NOT NULL,
	"room_id" uuid,
	"world_id" uuid,
	"unique" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "fragment_metadata_check" CHECK (
            CASE 
                WHEN metadata->>'type' = 'fragment' THEN
                    metadata ? 'documentId' AND 
                    metadata ? 'position'
                ELSE true
            END
        ),
	CONSTRAINT "document_metadata_check" CHECK (
            CASE 
                WHEN metadata->>'type' = 'document' THEN
                    metadata ? 'timestamp'
                ELSE true
            END
        )
);
--> statement-breakpoint
CREATE TABLE "message_server_agents" (
	"message_server_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	CONSTRAINT "message_server_agents_message_server_id_agent_id_pk" PRIMARY KEY("message_server_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "message_servers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "central_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"raw_message" jsonb,
	"in_reply_to_root_message_id" text,
	"source_type" text,
	"source_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" uuid,
	"room_id" uuid,
	"agent_id" uuid,
	"room_state" text
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"tags" text[],
	"metadata" jsonb,
	CONSTRAINT "unique_relationship" UNIQUE("source_entity_id","target_entity_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"message_server_id" uuid,
	"world_id" uuid,
	"name" text,
	"metadata" jsonb,
	"channel_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"room_id" uuid,
	"world_id" uuid,
	"entity_id" uuid,
	"agent_id" uuid NOT NULL,
	"tags" text[] DEFAULT '{}'::text[],
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb,
	"message_server_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AdminRole" ADD CONSTRAINT "AdminRole_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AdminRole" ADD CONSTRAINT "AdminRole_grantedBy_User_id_fk" FOREIGN KEY ("grantedBy") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Question" ADD CONSTRAINT "Question_marketId_Market_id_fk" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ArcState" ADD CONSTRAINT "ArcState_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionArcPlan" ADD CONSTRAINT "QuestionArcPlan_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubMarketSpawnLog" ADD CONSTRAINT "SubMarketSpawnLog_parentMarketId_TimeframedMarket_id_fk" FOREIGN KEY ("parentMarketId") REFERENCES "public"."TimeframedMarket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubMarketSpawnLog" ADD CONSTRAINT "SubMarketSpawnLog_spawnedMarketId_TimeframedMarket_id_fk" FOREIGN KEY ("spawnedMarketId") REFERENCES "public"."TimeframedMarket"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TimeframedMarket" ADD CONSTRAINT "TimeframedMarket_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TimeframedMarket" ADD CONSTRAINT "TimeframedMarket_parentMarketId_TimeframedMarket_id_fk" FOREIGN KEY ("parentMarketId") REFERENCES "public"."TimeframedMarket"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TimeframedMarket" ADD CONSTRAINT "TimeframedMarket_rootMarketId_TimeframedMarket_id_fk" FOREIGN KEY ("rootMarketId") REFERENCES "public"."TimeframedMarket"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GameOnboarding" ADD CONSTRAINT "GameOnboarding_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserPnLSnapshot" ADD CONSTRAINT "UserPnLSnapshot_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Whitelist" ADD CONSTRAINT "Whitelist_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Whitelist" ADD CONSTRAINT "Whitelist_grantedBy_User_id_fk" FOREIGN KEY ("grantedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WhitelistConfig" ADD CONSTRAINT "WhitelistConfig_updatedBy_User_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cache" ADD CONSTRAINT "cache_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_participants" ADD CONSTRAINT "channel_participants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_message_server_id_message_servers_id_fk" FOREIGN KEY ("message_server_id") REFERENCES "public"."message_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "fk_room" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "fk_user" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "fk_room" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "fk_user" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "fk_agent" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_server_agents" ADD CONSTRAINT "message_server_agents_message_server_id_message_servers_id_fk" FOREIGN KEY ("message_server_id") REFERENCES "public"."message_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_server_agents" ADD CONSTRAINT "message_server_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_messages" ADD CONSTRAINT "central_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_messages" ADD CONSTRAINT "central_messages_in_reply_to_root_message_id_central_messages_id_fk" FOREIGN KEY ("in_reply_to_root_message_id") REFERENCES "public"."central_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "fk_room" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "fk_user" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_target_entity_id_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "fk_user_a" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "fk_user_b" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement" USING btree ("userId","unlockedAt");--> statement-breakpoint
CREATE INDEX "UserAchievement_unlockedAt_idx" ON "UserAchievement" USING btree ("unlockedAt");--> statement-breakpoint
CREATE INDEX "UserChallengeProgress_userId_periodKey_idx" ON "UserChallengeProgress" USING btree ("userId","periodKey");--> statement-breakpoint
CREATE INDEX "ActorState_hasPool_idx" ON "ActorState" USING btree ("hasPool");--> statement-breakpoint
CREATE INDEX "ActorState_reputationPoints_idx" ON "ActorState" USING btree ("reputationPoints");--> statement-breakpoint
CREATE INDEX "ActorState_lastPostAt_idx" ON "ActorState" USING btree ("lastPostAt");--> statement-breakpoint
CREATE INDEX "ActorState_lastActiveAt_idx" ON "ActorState" USING btree ("lastActiveAt");--> statement-breakpoint
CREATE INDEX "ActorFollow_followerId_idx" ON "ActorFollow" USING btree ("followerId");--> statement-breakpoint
CREATE INDEX "ActorFollow_followingId_idx" ON "ActorFollow" USING btree ("followingId");--> statement-breakpoint
CREATE INDEX "ActorFollow_isMutual_idx" ON "ActorFollow" USING btree ("isMutual");--> statement-breakpoint
CREATE INDEX "ActorRelationship_actor1Id_idx" ON "ActorRelationship" USING btree ("actor1Id");--> statement-breakpoint
CREATE INDEX "ActorRelationship_actor2Id_idx" ON "ActorRelationship" USING btree ("actor2Id");--> statement-breakpoint
CREATE INDEX "ActorRelationship_relationshipType_idx" ON "ActorRelationship" USING btree ("relationshipType");--> statement-breakpoint
CREATE INDEX "ActorRelationship_sentiment_idx" ON "ActorRelationship" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "ActorRelationship_strength_idx" ON "ActorRelationship" USING btree ("strength");--> statement-breakpoint
CREATE INDEX "ActorRelationship_lastInteraction_idx" ON "ActorRelationship" USING btree ("lastInteraction");--> statement-breakpoint
CREATE INDEX "NPCInteraction_actor1Id_actor2Id_timestamp_idx" ON "NPCInteraction" USING btree ("actor1Id","actor2Id","timestamp");--> statement-breakpoint
CREATE INDEX "NPCInteraction_timestamp_idx" ON "NPCInteraction" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "NPCInteraction_actor1Id_idx" ON "NPCInteraction" USING btree ("actor1Id");--> statement-breakpoint
CREATE INDEX "NPCInteraction_actor2Id_idx" ON "NPCInteraction" USING btree ("actor2Id");--> statement-breakpoint
CREATE INDEX "NPCInteraction_interactionType_idx" ON "NPCInteraction" USING btree ("interactionType");--> statement-breakpoint
CREATE INDEX "NPCTrade_executedAt_idx" ON "NPCTrade" USING btree ("executedAt");--> statement-breakpoint
CREATE INDEX "NPCTrade_marketType_marketId_executedAt_idx" ON "NPCTrade" USING btree ("marketType","marketId","executedAt");--> statement-breakpoint
CREATE INDEX "NPCTrade_marketType_ticker_idx" ON "NPCTrade" USING btree ("marketType","ticker");--> statement-breakpoint
CREATE INDEX "NPCTrade_npcActorId_executedAt_idx" ON "NPCTrade" USING btree ("npcActorId","executedAt");--> statement-breakpoint
CREATE INDEX "NPCTrade_poolId_executedAt_idx" ON "NPCTrade" USING btree ("poolId","executedAt");--> statement-breakpoint
CREATE INDEX "AdminRole_role_idx" ON "AdminRole" USING btree ("role");--> statement-breakpoint
CREATE INDEX "AdminRole_userId_idx" ON "AdminRole" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "AdminRole_grantedAt_idx" ON "AdminRole" USING btree ("grantedAt");--> statement-breakpoint
CREATE INDEX "AdminRole_revokedAt_idx" ON "AdminRole" USING btree ("revokedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "SystemMetricsSnapshot_timestamp_environment_unique_idx" ON "SystemMetricsSnapshot" USING btree ("timestamp","environment");--> statement-breakpoint
CREATE INDEX "SystemMetricsSnapshot_environment_timestamp_idx" ON "SystemMetricsSnapshot" USING btree ("environment","timestamp");--> statement-breakpoint
CREATE INDEX "SystemMetricsSnapshot_createdAt_idx" ON "SystemMetricsSnapshot" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "AgentCapability_agentRegistryId_idx" ON "AgentCapability" USING btree ("agentRegistryId");--> statement-breakpoint
CREATE INDEX "AgentGoalAction_goalId_idx" ON "AgentGoalAction" USING btree ("goalId");--> statement-breakpoint
CREATE INDEX "AgentGoalAction_agentUserId_createdAt_idx" ON "AgentGoalAction" USING btree ("agentUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentGoalAction_actionType_idx" ON "AgentGoalAction" USING btree ("actionType");--> statement-breakpoint
CREATE INDEX "AgentGoal_agentUserId_status_idx" ON "AgentGoal" USING btree ("agentUserId","status");--> statement-breakpoint
CREATE INDEX "AgentGoal_priority_idx" ON "AgentGoal" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "AgentGoal_status_idx" ON "AgentGoal" USING btree ("status");--> statement-breakpoint
CREATE INDEX "AgentGoal_createdAt_idx" ON "AgentGoal" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "AgentLog_agentUserId_createdAt_idx" ON "AgentLog" USING btree ("agentUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentLog_level_idx" ON "AgentLog" USING btree ("level");--> statement-breakpoint
CREATE INDEX "AgentLog_type_createdAt_idx" ON "AgentLog" USING btree ("type","createdAt");--> statement-breakpoint
CREATE INDEX "AgentMessage_agentUserId_createdAt_idx" ON "AgentMessage" USING btree ("agentUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentMessage_role_idx" ON "AgentMessage" USING btree ("role");--> statement-breakpoint
CREATE INDEX "AgentPerformanceMetrics_gamesPlayed_idx" ON "AgentPerformanceMetrics" USING btree ("gamesPlayed");--> statement-breakpoint
CREATE INDEX "AgentPerformanceMetrics_normalizedPnL_idx" ON "AgentPerformanceMetrics" USING btree ("normalizedPnL");--> statement-breakpoint
CREATE INDEX "AgentPerformanceMetrics_reputationScore_idx" ON "AgentPerformanceMetrics" USING btree ("reputationScore");--> statement-breakpoint
CREATE INDEX "AgentPerformanceMetrics_trustLevel_idx" ON "AgentPerformanceMetrics" USING btree ("trustLevel");--> statement-breakpoint
CREATE INDEX "AgentPerformanceMetrics_updatedAt_idx" ON "AgentPerformanceMetrics" USING btree ("updatedAt");--> statement-breakpoint
CREATE INDEX "AgentPointsTransaction_agentUserId_createdAt_idx" ON "AgentPointsTransaction" USING btree ("agentUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentPointsTransaction_managerUserId_createdAt_idx" ON "AgentPointsTransaction" USING btree ("managerUserId","createdAt");--> statement-breakpoint
CREATE INDEX "AgentPointsTransaction_type_idx" ON "AgentPointsTransaction" USING btree ("type");--> statement-breakpoint
CREATE INDEX "AgentRegistry_type_status_idx" ON "AgentRegistry" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "AgentRegistry_trustLevel_idx" ON "AgentRegistry" USING btree ("trustLevel");--> statement-breakpoint
CREATE INDEX "AgentRegistry_userId_idx" ON "AgentRegistry" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "AgentRegistry_actorId_idx" ON "AgentRegistry" USING btree ("actorId");--> statement-breakpoint
CREATE INDEX "AgentRegistry_status_lastActiveAt_idx" ON "AgentRegistry" USING btree ("status","lastActiveAt");--> statement-breakpoint
CREATE INDEX "AgentRegistry_type_trustLevel_idx" ON "AgentRegistry" USING btree ("type","trustLevel");--> statement-breakpoint
CREATE INDEX "AgentTrade_agentUserId_executedAt_idx" ON "AgentTrade" USING btree ("agentUserId","executedAt");--> statement-breakpoint
CREATE INDEX "AgentTrade_marketType_marketId_idx" ON "AgentTrade" USING btree ("marketType","marketId");--> statement-breakpoint
CREATE INDEX "AgentTrade_ticker_idx" ON "AgentTrade" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "ExternalAgentConnection_agentRegistryId_idx" ON "ExternalAgentConnection" USING btree ("agentRegistryId");--> statement-breakpoint
CREATE INDEX "ExternalAgentConnection_externalId_idx" ON "ExternalAgentConnection" USING btree ("externalId");--> statement-breakpoint
CREATE INDEX "ExternalAgentConnection_protocol_idx" ON "ExternalAgentConnection" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "ExternalAgentConnection_isHealthy_idx" ON "ExternalAgentConnection" USING btree ("isHealthy");--> statement-breakpoint
CREATE INDEX "ExternalAgentConnection_revokedAt_idx" ON "ExternalAgentConnection" USING btree ("revokedAt");--> statement-breakpoint
CREATE INDEX "Market_createdAt_idx" ON "Market" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Market_gameId_dayNumber_idx" ON "Market" USING btree ("gameId","dayNumber");--> statement-breakpoint
CREATE INDEX "Market_resolved_endDate_idx" ON "Market" USING btree ("resolved","endDate");--> statement-breakpoint
CREATE INDEX "Organization_currentPrice_idx" ON "Organization" USING btree ("currentPrice");--> statement-breakpoint
CREATE INDEX "Organization_type_idx" ON "Organization" USING btree ("type");--> statement-breakpoint
CREATE INDEX "Organization_ticker_idx" ON "Organization" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "PerpMarketSnapshot_orgId_idx" ON "PerpMarketSnapshot" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "PerpPosition_organizationId_idx" ON "PerpPosition" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "PerpPosition_ticker_idx" ON "PerpPosition" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "PerpPosition_userId_closedAt_idx" ON "PerpPosition" USING btree ("userId","closedAt");--> statement-breakpoint
CREATE INDEX "PerpPosition_userId_openedAt_idx" ON "PerpPosition" USING btree ("userId","openedAt");--> statement-breakpoint
CREATE INDEX "Position_createdAt_idx" ON "Position" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Position_marketId_idx" ON "Position" USING btree ("marketId");--> statement-breakpoint
CREATE INDEX "Position_questionId_idx" ON "Position" USING btree ("questionId");--> statement-breakpoint
CREATE INDEX "Position_status_resolvedAt_idx" ON "Position" USING btree ("status","resolvedAt");--> statement-breakpoint
CREATE INDEX "Position_status_idx" ON "Position" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Position_userId_idx" ON "Position" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Position_userId_createdAt_idx" ON "Position" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Position_userId_marketId_idx" ON "Position" USING btree ("userId","marketId");--> statement-breakpoint
CREATE INDEX "Position_userId_resolvedAt_idx" ON "Position" USING btree ("userId","resolvedAt");--> statement-breakpoint
CREATE INDEX "Position_userId_status_idx" ON "Position" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "PredictionPriceHistory_marketId_createdAt_idx" ON "PredictionPriceHistory" USING btree ("marketId","createdAt");--> statement-breakpoint
CREATE INDEX "Question_marketId_idx" ON "Question" USING btree ("marketId");--> statement-breakpoint
CREATE INDEX "Question_createdDate_idx" ON "Question" USING btree ("createdDate");--> statement-breakpoint
CREATE INDEX "Question_status_resolutionDate_idx" ON "Question" USING btree ("status","resolutionDate");--> statement-breakpoint
CREATE INDEX "Question_topicKey_topicDate_idx" ON "Question" USING btree ("topicKey","topicDate");--> statement-breakpoint
CREATE INDEX "Question_requiresManualReview_status_idx" ON "Question" USING btree ("status","requiresManualReview","resolutionReviewStatus");--> statement-breakpoint
CREATE INDEX "StockPrice_isSnapshot_timestamp_idx" ON "StockPrice" USING btree ("isSnapshot","timestamp");--> statement-breakpoint
CREATE INDEX "StockPrice_organizationId_timestamp_idx" ON "StockPrice" USING btree ("organizationId","timestamp");--> statement-breakpoint
CREATE INDEX "StockPrice_timestamp_idx" ON "StockPrice" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "ChatParticipant_chatId_idx" ON "ChatParticipant" USING btree ("chatId");--> statement-breakpoint
CREATE INDEX "ChatParticipant_userId_idx" ON "ChatParticipant" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ChatParticipant_chatId_isActive_idx" ON "ChatParticipant" USING btree ("chatId","isActive");--> statement-breakpoint
CREATE INDEX "ChatParticipant_userId_isActive_idx" ON "ChatParticipant" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX "Chat_gameId_dayNumber_idx" ON "Chat" USING btree ("gameId","dayNumber");--> statement-breakpoint
CREATE INDEX "Chat_groupId_idx" ON "Chat" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "Chat_isGroup_idx" ON "Chat" USING btree ("isGroup");--> statement-breakpoint
CREATE INDEX "Chat_createdBy_idx" ON "Chat" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "Chat_relatedQuestion_idx" ON "Chat" USING btree ("relatedQuestion");--> statement-breakpoint
CREATE INDEX "Chat_nftGated_idx" ON "Chat" USING btree ("nftGated");--> statement-breakpoint
CREATE INDEX "Chat_requiredNftContractAddress_idx" ON "Chat" USING btree ("requiredNftContractAddress");--> statement-breakpoint
CREATE INDEX "DMAcceptance_status_createdAt_idx" ON "DMAcceptance" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "DMAcceptance_userId_status_idx" ON "DMAcceptance" USING btree ("userId","status");--> statement-breakpoint
CREATE INDEX "GroupInvite_groupId_idx" ON "GroupInvite" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "GroupInvite_invitedUserId_status_idx" ON "GroupInvite" USING btree ("invitedUserId","status");--> statement-breakpoint
CREATE INDEX "GroupInvite_status_idx" ON "GroupInvite" USING btree ("status");--> statement-breakpoint
CREATE INDEX "GroupInvite_invitedUserId_status_declineCount_idx" ON "GroupInvite" USING btree ("invitedUserId","status","declineCount");--> statement-breakpoint
CREATE INDEX "GroupInvite_nextEligibleAt_idx" ON "GroupInvite" USING btree ("nextEligibleAt");--> statement-breakpoint
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "GroupMember_userId_joinedAt_idx" ON "GroupMember" USING btree ("userId","joinedAt");--> statement-breakpoint
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "GroupMember_groupId_isActive_idx" ON "GroupMember" USING btree ("groupId","isActive");--> statement-breakpoint
CREATE INDEX "GroupMember_userId_isActive_idx" ON "GroupMember" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX "GroupMember_lastMessageAt_idx" ON "GroupMember" USING btree ("lastMessageAt");--> statement-breakpoint
CREATE INDEX "GroupMember_role_idx" ON "GroupMember" USING btree ("role");--> statement-breakpoint
CREATE INDEX "GroupMember_tier_idx" ON "GroupMember" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "GroupMember_userId_isActive_tier_idx" ON "GroupMember" USING btree ("userId","isActive","tier");--> statement-breakpoint
CREATE INDEX "GroupMember_isActive_tier_idx" ON "GroupMember" USING btree ("isActive","tier");--> statement-breakpoint
CREATE INDEX "GroupMember_isGrandfathered_idx" ON "GroupMember" USING btree ("isGrandfathered");--> statement-breakpoint
CREATE INDEX "Group_type_idx" ON "Group" USING btree ("type");--> statement-breakpoint
CREATE INDEX "Group_ownerId_idx" ON "Group" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "Group_createdById_createdAt_idx" ON "Group" USING btree ("createdById","createdAt");--> statement-breakpoint
CREATE INDEX "Group_createdById_idx" ON "Group" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Group_createdAt_idx" ON "Group" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Group_tier_idx" ON "Group" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "Group_ownerId_tier_idx" ON "Group" USING btree ("ownerId","tier");--> statement-breakpoint
CREATE INDEX "Group_parentGroupId_idx" ON "Group" USING btree ("parentGroupId");--> statement-breakpoint
CREATE UNIQUE INDEX "Group_team_ownerId_unique" ON "Group" USING btree ("ownerId") WHERE "Group"."type" = 'team';--> statement-breakpoint
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "MessageReaction_chatId_idx" ON "MessageReaction" USING btree ("chatId");--> statement-breakpoint
CREATE INDEX "MessageReaction_userId_idx" ON "MessageReaction" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "MessageReaction_chatId_messageId_idx" ON "MessageReaction" USING btree ("chatId","messageId");--> statement-breakpoint
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message" USING btree ("chatId","createdAt");--> statement-breakpoint
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message" USING btree ("senderId","createdAt");--> statement-breakpoint
CREATE INDEX "Message_senderId_idx" ON "Message" USING btree ("senderId");--> statement-breakpoint
CREATE INDEX "Message_type_idx" ON "Message" USING btree ("type");--> statement-breakpoint
CREATE INDEX "Message_targetIds_idx" ON "Message" USING gin ("targetIds");--> statement-breakpoint
CREATE INDEX "Message_replyToMessageId_idx" ON "Message" USING btree ("replyToMessageId");--> statement-breakpoint
CREATE INDEX "Notification_chatId_idx" ON "Notification" USING btree ("chatId");--> statement-breakpoint
CREATE UNIQUE INDEX "Notification_dedupeKey_unique" ON "Notification" USING btree ("dedupeKey") WHERE "Notification"."dedupeKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "Notification_groupId_idx" ON "Notification" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "Notification_inviteId_idx" ON "Notification" USING btree ("inviteId");--> statement-breakpoint
CREATE INDEX "Notification_read_idx" ON "Notification" USING btree ("read");--> statement-breakpoint
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_userId_type_actorId_createdAt_idx" ON "Notification" USING btree ("userId","type","actorId","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification" USING btree ("userId","read","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_userId_type_read_idx" ON "Notification" USING btree ("userId","type","read");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog" USING btree ("adminId");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog" USING btree ("action");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_resourceType_idx" ON "AdminAuditLog" USING btree ("resourceType");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_resourceId_idx" ON "AdminAuditLog" USING btree ("resourceId");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog" USING btree ("adminId","createdAt");--> statement-breakpoint
CREATE INDEX "AnalyticsDailySnapshot_date_idx" ON "AnalyticsDailySnapshot" USING btree ("date");--> statement-breakpoint
CREATE INDEX "AnalyticsDailySnapshot_createdAt_idx" ON "AnalyticsDailySnapshot" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "DailyTopic_date_idx" ON "DailyTopic" USING btree ("date");--> statement-breakpoint
CREATE INDEX "DailyTopic_topicKey_idx" ON "DailyTopic" USING btree ("topicKey");--> statement-breakpoint
CREATE INDEX "DailyTopic_isLocked_date_idx" ON "DailyTopic" USING btree ("isLocked","date");--> statement-breakpoint
CREATE INDEX "GameConfig_key_idx" ON "GameConfig" USING btree ("key");--> statement-breakpoint
CREATE INDEX "Game_isContinuous_idx" ON "Game" USING btree ("isContinuous");--> statement-breakpoint
CREATE INDEX "Game_isRunning_idx" ON "Game" USING btree ("isRunning");--> statement-breakpoint
CREATE INDEX "GenerationLock_expiresAt_idx" ON "GenerationLock" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "OAuthState_state_idx" ON "OAuthState" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ParodyHeadline_isUsed_generatedAt_idx" ON "ParodyHeadline" USING btree ("isUsed","generatedAt");--> statement-breakpoint
CREATE INDEX "ParodyHeadline_generatedAt_idx" ON "ParodyHeadline" USING btree ("generatedAt");--> statement-breakpoint
CREATE INDEX "RealtimeOutbox_status_createdAt_idx" ON "RealtimeOutbox" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "RealtimeOutbox_channel_status_idx" ON "RealtimeOutbox" USING btree ("channel","status");--> statement-breakpoint
CREATE INDEX "RSSFeedSource_isActive_lastFetched_idx" ON "RSSFeedSource" USING btree ("isActive","lastFetched");--> statement-breakpoint
CREATE INDEX "RSSFeedSource_category_idx" ON "RSSFeedSource" USING btree ("category");--> statement-breakpoint
CREATE INDEX "RSSHeadline_sourceId_publishedAt_idx" ON "RSSHeadline" USING btree ("sourceId","publishedAt");--> statement-breakpoint
CREATE INDEX "RSSHeadline_publishedAt_idx" ON "RSSHeadline" USING btree ("publishedAt");--> statement-breakpoint
CREATE INDEX "SentryIncidentAlertOutbox_status_nextAttemptAt_idx" ON "SentryIncidentAlertOutbox" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "SentryIncidentAlertOutbox_issueKey_createdAt_idx" ON "SentryIncidentAlertOutbox" USING btree ("sentryIssueKey","createdAt");--> statement-breakpoint
CREATE INDEX "SentryIncidentAlertOutbox_runId_idx" ON "SentryIncidentAlertOutbox" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "SentryIncidentAlertOutbox_inboxId_idx" ON "SentryIncidentAlertOutbox" USING btree ("inboxId");--> statement-breakpoint
CREATE INDEX "SentryIncidentDiscordThread_threadId_idx" ON "SentryIncidentDiscordThread" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "SentryIncidentRun_inboxId_idx" ON "SentryIncidentRun" USING btree ("inboxId");--> statement-breakpoint
CREATE INDEX "SentryIncidentRun_issueKey_createdAt_idx" ON "SentryIncidentRun" USING btree ("sentryIssueKey","createdAt");--> statement-breakpoint
CREATE INDEX "SentryIncidentRun_linearIssueId_idx" ON "SentryIncidentRun" USING btree ("linearIssueId");--> statement-breakpoint
CREATE INDEX "SentryIncidentRun_status_createdAt_idx" ON "SentryIncidentRun" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "SentryWebhookInbox_status_nextAttemptAt_idx" ON "SentryWebhookInbox" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "SentryWebhookInbox_project_issue_status_idx" ON "SentryWebhookInbox" USING btree ("projectSlug","issueId","status");--> statement-breakpoint
CREATE INDEX "SentryWebhookInbox_eventId_idx" ON "SentryWebhookInbox" USING btree ("eventId");--> statement-breakpoint
CREATE INDEX "SentryWebhookInbox_routingKey_status_idx" ON "SentryWebhookInbox" USING btree ("routingKey","status");--> statement-breakpoint
CREATE INDEX "SentryWebhookInbox_receivedAt_idx" ON "SentryWebhookInbox" USING btree ("receivedAt");--> statement-breakpoint
CREATE INDEX "SentryWebhookInbox_resource_action_idx" ON "SentryWebhookInbox" USING btree ("resource","action");--> statement-breakpoint
CREATE INDEX "TickTokenStats_tickStartedAt_idx" ON "TickTokenStats" USING btree ("tickStartedAt");--> statement-breakpoint
CREATE INDEX "TickTokenStats_tickId_idx" ON "TickTokenStats" USING btree ("tickId");--> statement-breakpoint
CREATE INDEX "TickTokenStats_createdAt_idx" ON "TickTokenStats" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "WidgetCache_widget_updatedAt_idx" ON "WidgetCache" USING btree ("widget","updatedAt");--> statement-breakpoint
CREATE INDEX "WorldEvent_gameId_dayNumber_idx" ON "WorldEvent" USING btree ("gameId","dayNumber");--> statement-breakpoint
CREATE INDEX "WorldEvent_relatedQuestion_idx" ON "WorldEvent" USING btree ("relatedQuestion");--> statement-breakpoint
CREATE INDEX "WorldEvent_timestamp_idx" ON "WorldEvent" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "WorldFact_category_isActive_idx" ON "WorldFact" USING btree ("category","isActive");--> statement-breakpoint
CREATE INDEX "WorldFact_priority_idx" ON "WorldFact" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "WorldFact_lastUpdated_idx" ON "WorldFact" USING btree ("lastUpdated");--> statement-breakpoint
CREATE INDEX "WorldFact_source_createdAt_idx" ON "WorldFact" USING btree ("source","createdAt" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "arc_coverage_event_org_status" ON "arc_event_coverage" USING btree ("event_id","org_id","status");--> statement-breakpoint
CREATE INDEX "arc_coverage_event_status_idx" ON "arc_event_coverage" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "arc_coverage_covered_at_idx" ON "arc_event_coverage" USING btree ("covered_at");--> statement-breakpoint
CREATE INDEX "ArcState_currentState_idx" ON "ArcState" USING btree ("currentState");--> statement-breakpoint
CREATE INDEX "QuestionArcPlan_questionId_idx" ON "QuestionArcPlan" USING btree ("questionId");--> statement-breakpoint
CREATE INDEX "SubMarketSpawnLog_parentMarketId_idx" ON "SubMarketSpawnLog" USING btree ("parentMarketId");--> statement-breakpoint
CREATE INDEX "SubMarketSpawnLog_spawnedMarketId_idx" ON "SubMarketSpawnLog" USING btree ("spawnedMarketId");--> statement-breakpoint
CREATE INDEX "SubMarketSpawnLog_eventType_idx" ON "SubMarketSpawnLog" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "SubMarketSpawnLog_createdAt_idx" ON "SubMarketSpawnLog" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_questionId_idx" ON "TimeframedMarket" USING btree ("questionId");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_parentMarketId_idx" ON "TimeframedMarket" USING btree ("parentMarketId");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_rootMarketId_idx" ON "TimeframedMarket" USING btree ("rootMarketId");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_timeframe_idx" ON "TimeframedMarket" USING btree ("timeframe");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_category_idx" ON "TimeframedMarket" USING btree ("category");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_topicKey_topicDate_idx" ON "TimeframedMarket" USING btree ("topicKey","topicDate");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_granularTimeframe_idx" ON "TimeframedMarket" USING btree ("granularTimeframe");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_isActive_idx" ON "TimeframedMarket" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_isActive_isResolved_endTime_idx" ON "TimeframedMarket" USING btree ("isActive","isResolved","endTime");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_endTime_idx" ON "TimeframedMarket" USING btree ("endTime");--> statement-breakpoint
CREATE INDEX "TimeframedMarket_startTime_endTime_idx" ON "TimeframedMarket" USING btree ("startTime","endTime");--> statement-breakpoint
CREATE INDEX "NftClaim_claimerUserId_idx" ON "NftClaim" USING btree ("claimerUserId");--> statement-breakpoint
CREATE INDEX "NftClaim_claimerAddress_idx" ON "NftClaim" USING btree ("claimerAddress");--> statement-breakpoint
CREATE INDEX "NftCollection_tokenId_idx" ON "NftCollection" USING btree ("tokenId");--> statement-breakpoint
CREATE INDEX "NftCollection_contractAddress_idx" ON "NftCollection" USING btree ("contractAddress");--> statement-breakpoint
CREATE INDEX "NftOwnership_ownerAddress_idx" ON "NftOwnership" USING btree ("ownerAddress");--> statement-breakpoint
CREATE INDEX "NftOwnership_userId_idx" ON "NftOwnership" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "NftOwnership_updatedAt_idx" ON "NftOwnership" USING btree ("updatedAt");--> statement-breakpoint
CREATE INDEX "NftSnapshot_walletAddress_idx" ON "NftSnapshot" USING btree ("walletAddress");--> statement-breakpoint
CREATE INDEX "NftSnapshot_hasMinted_idx" ON "NftSnapshot" USING btree ("hasMinted");--> statement-breakpoint
CREATE INDEX "NftSnapshot_rank_idx" ON "NftSnapshot" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "OrganizationState_currentPrice_idx" ON "OrganizationState" USING btree ("currentPrice");--> statement-breakpoint
CREATE INDEX "OrganizationState_sentiment_idx" ON "OrganizationState" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "PoolDeposit_poolId_userId_idx" ON "PoolDeposit" USING btree ("poolId","userId");--> statement-breakpoint
CREATE INDEX "PoolDeposit_poolId_withdrawnAt_idx" ON "PoolDeposit" USING btree ("poolId","withdrawnAt");--> statement-breakpoint
CREATE INDEX "PoolDeposit_userId_depositedAt_idx" ON "PoolDeposit" USING btree ("userId","depositedAt");--> statement-breakpoint
CREATE INDEX "PoolPosition_marketType_marketId_idx" ON "PoolPosition" USING btree ("marketType","marketId");--> statement-breakpoint
CREATE INDEX "PoolPosition_marketType_ticker_idx" ON "PoolPosition" USING btree ("marketType","ticker");--> statement-breakpoint
CREATE INDEX "PoolPosition_poolId_closedAt_idx" ON "PoolPosition" USING btree ("poolId","closedAt");--> statement-breakpoint
CREATE INDEX "Pool_isActive_idx" ON "Pool" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "Pool_npcActorId_idx" ON "Pool" USING btree ("npcActorId");--> statement-breakpoint
CREATE INDEX "Pool_status_idx" ON "Pool" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Pool_totalValue_idx" ON "Pool" USING btree ("totalValue");--> statement-breakpoint
CREATE INDEX "Pool_volume24h_idx" ON "Pool" USING btree ("volume24h");--> statement-breakpoint
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment" USING btree ("authorId","createdAt");--> statement-breakpoint
CREATE INDEX "Comment_authorId_idx" ON "Comment" USING btree ("authorId");--> statement-breakpoint
CREATE INDEX "Comment_deletedAt_idx" ON "Comment" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "Comment_parentCommentId_idx" ON "Comment" USING btree ("parentCommentId");--> statement-breakpoint
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment" USING btree ("postId","createdAt");--> statement-breakpoint
CREATE INDEX "Comment_postId_deletedAt_idx" ON "Comment" USING btree ("postId","deletedAt");--> statement-breakpoint
CREATE INDEX "FeedEvent_actionType_createdAt_idx" ON "FeedEvent" USING btree ("actionType","createdAt");--> statement-breakpoint
CREATE INDEX "FeedEvent_clusterId_createdAt_idx" ON "FeedEvent" USING btree ("clusterId","createdAt");--> statement-breakpoint
CREATE INDEX "FeedEvent_itemId_createdAt_idx" ON "FeedEvent" USING btree ("itemId","createdAt");--> statement-breakpoint
CREATE INDEX "FeedEvent_surface_createdAt_idx" ON "FeedEvent" USING btree ("surface","createdAt");--> statement-breakpoint
CREATE INDEX "FeedEvent_topicKey_createdAt_idx" ON "FeedEvent" USING btree ("topicKey","createdAt");--> statement-breakpoint
CREATE INDEX "FeedEvent_userId_surface_createdAt_idx" ON "FeedEvent" USING btree ("userId","surface","createdAt");--> statement-breakpoint
CREATE INDEX "PostTag_postId_idx" ON "PostTag" USING btree ("postId");--> statement-breakpoint
CREATE INDEX "PostTag_tagId_createdAt_idx" ON "PostTag" USING btree ("tagId","createdAt");--> statement-breakpoint
CREATE INDEX "PostTag_tagId_idx" ON "PostTag" USING btree ("tagId");--> statement-breakpoint
CREATE INDEX "Post_createdAt_idx" ON "Post" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Post_authorId_timestamp_idx" ON "Post" USING btree ("authorId","timestamp");--> statement-breakpoint
CREATE INDEX "Post_authorId_type_timestamp_idx" ON "Post" USING btree ("authorId","type","timestamp");--> statement-breakpoint
CREATE INDEX "Post_commentOnPostId_idx" ON "Post" USING btree ("commentOnPostId");--> statement-breakpoint
CREATE INDEX "Post_deletedAt_idx" ON "Post" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "Post_gameId_dayNumber_idx" ON "Post" USING btree ("gameId","dayNumber");--> statement-breakpoint
CREATE INDEX "Post_parentCommentId_idx" ON "Post" USING btree ("parentCommentId");--> statement-breakpoint
CREATE INDEX "Post_originalPostId_idx" ON "Post" USING btree ("originalPostId");--> statement-breakpoint
CREATE INDEX "Post_timestamp_idx" ON "Post" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "Post_type_deletedAt_timestamp_idx" ON "Post" USING btree ("type","deletedAt","timestamp");--> statement-breakpoint
CREATE INDEX "Post_type_timestamp_idx" ON "Post" USING btree ("type","timestamp");--> statement-breakpoint
CREATE INDEX "Post_relatedQuestion_idx" ON "Post" USING btree ("relatedQuestion");--> statement-breakpoint
CREATE INDEX "Reaction_commentId_idx" ON "Reaction" USING btree ("commentId");--> statement-breakpoint
CREATE INDEX "Reaction_postId_idx" ON "Reaction" USING btree ("postId");--> statement-breakpoint
CREATE INDEX "Reaction_userId_createdAt_idx" ON "Reaction" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Reaction_userId_idx" ON "Reaction" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ShareAction_contentType_idx" ON "ShareAction" USING btree ("contentType");--> statement-breakpoint
CREATE INDEX "ShareAction_platform_idx" ON "ShareAction" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "ShareAction_userId_createdAt_idx" ON "ShareAction" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "ShareAction_verified_idx" ON "ShareAction" USING btree ("verified");--> statement-breakpoint
CREATE INDEX "Share_createdAt_idx" ON "Share" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Share_postId_idx" ON "Share" USING btree ("postId");--> statement-breakpoint
CREATE INDEX "Share_userId_createdAt_idx" ON "Share" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Share_userId_idx" ON "Share" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Tag_name_idx" ON "Tag" USING btree ("name");--> statement-breakpoint
CREATE INDEX "TrendingTag_calculatedAt_idx" ON "TrendingTag" USING btree ("calculatedAt");--> statement-breakpoint
CREATE INDEX "TrendingTag_rank_calculatedAt_idx" ON "TrendingTag" USING btree ("rank","calculatedAt");--> statement-breakpoint
CREATE INDEX "TrendingTag_tagId_calculatedAt_idx" ON "TrendingTag" USING btree ("tagId","calculatedAt");--> statement-breakpoint
CREATE INDEX "scambench_session_participant_idx" ON "ScamBenchSession" USING btree ("participantId");--> statement-breakpoint
CREATE INDEX "scambench_session_source_idx" ON "ScamBenchSession" USING btree ("source");--> statement-breakpoint
CREATE INDEX "scambench_session_created_idx" ON "ScamBenchSession" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "TradeAttempt_userId_createdAt_idx" ON "TradeAttempt" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "TradeAttempt_outcome_createdAt_idx" ON "TradeAttempt" USING btree ("outcome","createdAt");--> statement-breakpoint
CREATE INDEX "TradeAttempt_createdAt_idx" ON "TradeAttempt" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "TradeAttempt_tradeType_outcome_createdAt_idx" ON "TradeAttempt" USING btree ("tradeType","outcome","createdAt");--> statement-breakpoint
CREATE INDEX "UserActivityLog_activityDate_idx" ON "UserActivityLog" USING btree ("activityDate");--> statement-breakpoint
CREATE INDEX "UserActivityLog_userId_activityDate_idx" ON "UserActivityLog" USING btree ("userId","activityDate");--> statement-breakpoint
CREATE INDEX "UserActivityLog_userId_activityType_idx" ON "UserActivityLog" USING btree ("userId","activityType");--> statement-breakpoint
CREATE INDEX "UserSession_userId_startedAt_idx" ON "UserSession" USING btree ("userId","startedAt");--> statement-breakpoint
CREATE INDEX "UserSession_userId_endedAt_idx" ON "UserSession" USING btree ("userId","endedAt");--> statement-breakpoint
CREATE INDEX "UserSession_startedAt_idx" ON "UserSession" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "UserSession_lastActiveAt_idx" ON "UserSession" USING btree ("lastActiveAt");--> statement-breakpoint
CREATE INDEX "UserSession_sessionId_idx" ON "UserSession" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "BalanceTransaction_type_idx" ON "BalanceTransaction" USING btree ("type");--> statement-breakpoint
CREATE INDEX "BalanceTransaction_userId_createdAt_idx" ON "BalanceTransaction" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "BalanceTransaction_type_createdAt_idx" ON "BalanceTransaction" USING btree ("type","createdAt");--> statement-breakpoint
CREATE INDEX "BalanceTransaction_userId_type_idx" ON "BalanceTransaction" USING btree ("userId","type");--> statement-breakpoint
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Feedback_fromUserId_idx" ON "Feedback" USING btree ("fromUserId");--> statement-breakpoint
CREATE INDEX "Feedback_gameId_idx" ON "Feedback" USING btree ("gameId");--> statement-breakpoint
CREATE INDEX "Feedback_interactionType_idx" ON "Feedback" USING btree ("interactionType");--> statement-breakpoint
CREATE INDEX "Feedback_score_idx" ON "Feedback" USING btree ("score");--> statement-breakpoint
CREATE INDEX "Feedback_toAgentId_idx" ON "Feedback" USING btree ("toAgentId");--> statement-breakpoint
CREATE INDEX "Feedback_toUserId_idx" ON "Feedback" USING btree ("toUserId");--> statement-breakpoint
CREATE INDEX "Feedback_toUserId_interactionType_idx" ON "Feedback" USING btree ("toUserId","interactionType");--> statement-breakpoint
CREATE INDEX "ModerationEscrow_recipientId_createdAt_idx" ON "ModerationEscrow" USING btree ("recipientId","createdAt");--> statement-breakpoint
CREATE INDEX "ModerationEscrow_adminId_idx" ON "ModerationEscrow" USING btree ("adminId");--> statement-breakpoint
CREATE INDEX "ModerationEscrow_status_idx" ON "ModerationEscrow" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ModerationEscrow_paymentRequestId_idx" ON "ModerationEscrow" USING btree ("paymentRequestId");--> statement-breakpoint
CREATE INDEX "ModerationEscrow_paymentTxHash_idx" ON "ModerationEscrow" USING btree ("paymentTxHash");--> statement-breakpoint
CREATE INDEX "ModerationEscrow_createdAt_idx" ON "ModerationEscrow" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "PointsTransaction_createdAt_idx" ON "PointsTransaction" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "PointsTransaction_paymentRequestId_idx" ON "PointsTransaction" USING btree ("paymentRequestId");--> statement-breakpoint
CREATE INDEX "PointsTransaction_reason_idx" ON "PointsTransaction" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "PointsTransaction_userId_createdAt_idx" ON "PointsTransaction" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "PointsTransaction_paymentProvider_idx" ON "PointsTransaction" USING btree ("paymentProvider");--> statement-breakpoint
CREATE INDEX "Report_reporterId_idx" ON "Report" USING btree ("reporterId");--> statement-breakpoint
CREATE INDEX "Report_reportedUserId_idx" ON "Report" USING btree ("reportedUserId");--> statement-breakpoint
CREATE INDEX "Report_reportedPostId_idx" ON "Report" USING btree ("reportedPostId");--> statement-breakpoint
CREATE INDEX "Report_reportedCommentId_idx" ON "Report" USING btree ("reportedCommentId");--> statement-breakpoint
CREATE INDEX "Report_status_idx" ON "Report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Report_priority_status_idx" ON "Report" USING btree ("priority","status");--> statement-breakpoint
CREATE INDEX "Report_category_idx" ON "Report" USING btree ("category");--> statement-breakpoint
CREATE INDEX "Report_createdAt_idx" ON "Report" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Report_reportedUserId_status_idx" ON "Report" USING btree ("reportedUserId","status");--> statement-breakpoint
CREATE INDEX "Report_reportedPostId_status_idx" ON "Report" USING btree ("reportedPostId","status");--> statement-breakpoint
CREATE INDEX "Report_reportedCommentId_status_idx" ON "Report" USING btree ("reportedCommentId","status");--> statement-breakpoint
CREATE INDEX "TradingFeeOutbox_createdAt_idx" ON "TradingFeeOutbox" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "TradingFeeOutbox_userId_createdAt_idx" ON "TradingFeeOutbox" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "TradingFee_createdAt_idx" ON "TradingFee" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "TradingFee_referrerId_createdAt_idx" ON "TradingFee" USING btree ("referrerId","createdAt");--> statement-breakpoint
CREATE INDEX "TradingFee_tradeType_idx" ON "TradingFee" USING btree ("tradeType");--> statement-breakpoint
CREATE INDEX "TradingFee_userId_createdAt_idx" ON "TradingFee" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "benchmark_results_modelId_idx" ON "benchmark_results" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "benchmark_results_benchmarkId_idx" ON "benchmark_results" USING btree ("benchmarkId");--> statement-breakpoint
CREATE INDEX "benchmark_results_runAt_idx" ON "benchmark_results" USING btree ("runAt");--> statement-breakpoint
CREATE INDEX "benchmark_results_optimalityScore_idx" ON "benchmark_results" USING btree ("optimalityScore");--> statement-breakpoint
CREATE INDEX "llm_call_logs_callId_idx" ON "llm_call_logs" USING btree ("callId");--> statement-breakpoint
CREATE INDEX "llm_call_logs_timestamp_idx" ON "llm_call_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "llm_call_logs_trajectoryId_idx" ON "llm_call_logs" USING btree ("trajectoryId");--> statement-breakpoint
CREATE INDEX "llm_call_logs_createdAt_idx" ON "llm_call_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "market_outcomes_windowId_idx" ON "market_outcomes" USING btree ("windowId");--> statement-breakpoint
CREATE INDEX "market_outcomes_windowId_stockTicker_idx" ON "market_outcomes" USING btree ("windowId","stockTicker");--> statement-breakpoint
CREATE INDEX "reaction_trajectories_eventId_idx" ON "reaction_trajectories" USING btree ("eventId");--> statement-breakpoint
CREATE INDEX "reaction_trajectories_npcId_idx" ON "reaction_trajectories" USING btree ("npcId");--> statement-breakpoint
CREATE INDEX "reaction_trajectories_createdAt_idx" ON "reaction_trajectories" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "reaction_trajectories_pendingOutcome_idx" ON "reaction_trajectories" USING btree ("createdAt","outcomeRecordedAt");--> statement-breakpoint
CREATE INDEX "reward_judgments_overallScore_idx" ON "reward_judgments" USING btree ("overallScore");--> statement-breakpoint
CREATE INDEX "reward_judgments_groupId_rank_idx" ON "reward_judgments" USING btree ("groupId","rank");--> statement-breakpoint
CREATE INDEX "trained_models_status_idx" ON "trained_models" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trained_models_version_idx" ON "trained_models" USING btree ("version");--> statement-breakpoint
CREATE INDEX "trained_models_deployedAt_idx" ON "trained_models" USING btree ("deployedAt");--> statement-breakpoint
CREATE INDEX "trained_models_lastBenchmarked_idx" ON "trained_models" USING btree ("lastBenchmarked");--> statement-breakpoint
CREATE INDEX "training_batches_scenarioId_idx" ON "training_batches" USING btree ("scenarioId");--> statement-breakpoint
CREATE INDEX "training_batches_status_createdAt_idx" ON "training_batches" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "trajectories_agentId_startTime_idx" ON "trajectories" USING btree ("agentId","startTime");--> statement-breakpoint
CREATE INDEX "trajectories_aiJudgeReward_idx" ON "trajectories" USING btree ("aiJudgeReward");--> statement-breakpoint
CREATE INDEX "trajectories_isTrainingData_usedInTraining_idx" ON "trajectories" USING btree ("isTrainingData","usedInTraining");--> statement-breakpoint
CREATE INDEX "trajectories_scenarioId_createdAt_idx" ON "trajectories" USING btree ("scenarioId","createdAt");--> statement-breakpoint
CREATE INDEX "trajectories_trainedInBatch_idx" ON "trajectories" USING btree ("trainedInBatch");--> statement-breakpoint
CREATE INDEX "trajectories_windowId_agentId_idx" ON "trajectories" USING btree ("windowId","agentId");--> statement-breakpoint
CREATE INDEX "trajectories_windowId_idx" ON "trajectories" USING btree ("windowId");--> statement-breakpoint
CREATE INDEX "trajectories_archetype_idx" ON "trajectories" USING btree ("archetype");--> statement-breakpoint
CREATE INDEX "world_state_snapshots_windowId_idx" ON "WorldStateSnapshot" USING btree ("windowId");--> statement-breakpoint
CREATE INDEX "world_state_snapshots_packId_idx" ON "WorldStateSnapshot" USING btree ("packId");--> statement-breakpoint
CREATE INDEX "UserAgentConfig_userId_idx" ON "UserAgentConfig" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "UserAgentConfig_status_idx" ON "UserAgentConfig" USING btree ("status");--> statement-breakpoint
CREATE INDEX "UserAgentConfig_autonomousTrading_idx" ON "UserAgentConfig" USING btree ("autonomousTrading");--> statement-breakpoint
CREATE INDEX "UserAgentConfig_alignment_team_idx" ON "UserAgentConfig" USING btree ("alignment","team");--> statement-breakpoint
CREATE INDEX "Favorite_targetUserId_idx" ON "Favorite" USING btree ("targetUserId");--> statement-breakpoint
CREATE INDEX "Favorite_userId_idx" ON "Favorite" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "FollowStatus_npcId_idx" ON "FollowStatus" USING btree ("npcId");--> statement-breakpoint
CREATE INDEX "FollowStatus_userId_isActive_idx" ON "FollowStatus" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX "Follow_followerId_createdAt_idx" ON "Follow" USING btree ("followerId","createdAt");--> statement-breakpoint
CREATE INDEX "Follow_followerId_idx" ON "Follow" USING btree ("followerId");--> statement-breakpoint
CREATE INDEX "Follow_followingId_idx" ON "Follow" USING btree ("followingId");--> statement-breakpoint
CREATE INDEX "GameOnboarding_isComplete_idx" ON "GameOnboarding" USING btree ("isComplete");--> statement-breakpoint
CREATE INDEX "GameOnboarding_currentStep_idx" ON "GameOnboarding" USING btree ("currentStep");--> statement-breakpoint
CREATE INDEX "OnboardingIntent_createdAt_idx" ON "OnboardingIntent" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "OnboardingIntent_status_idx" ON "OnboardingIntent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ProfileUpdateLog_userId_createdAt_idx" ON "ProfileUpdateLog" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Referral_referralCode_idx" ON "Referral" USING btree ("referralCode");--> statement-breakpoint
CREATE INDEX "Referral_referrerId_idx" ON "Referral" USING btree ("referrerId");--> statement-breakpoint
CREATE INDEX "Referral_referredUserId_idx" ON "Referral" USING btree ("referredUserId");--> statement-breakpoint
CREATE INDEX "Referral_status_createdAt_idx" ON "Referral" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "Referral_qualifiedAt_idx" ON "Referral" USING btree ("qualifiedAt");--> statement-breakpoint
CREATE INDEX "Referral_referrerId_status_qualifiedAt_signupPointsAwarded_idx" ON "Referral" USING btree ("referrerId","status","qualifiedAt","signupPointsAwarded");--> statement-breakpoint
CREATE INDEX "Referral_referrerId_signupPointsAwarded_completedAt_idx" ON "Referral" USING btree ("referrerId","signupPointsAwarded","completedAt");--> statement-breakpoint
CREATE INDEX "TwitterOAuthToken_userId_idx" ON "TwitterOAuthToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "UserActorFollow_actorId_idx" ON "UserActorFollow" USING btree ("actorId");--> statement-breakpoint
CREATE INDEX "UserActorFollow_userId_idx" ON "UserActorFollow" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "UserApiKey_userId_idx" ON "UserApiKey" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "UserApiKey_keyHash_idx" ON "UserApiKey" USING btree ("keyHash");--> statement-breakpoint
CREATE INDEX "UserApiKey_userId_revokedAt_idx" ON "UserApiKey" USING btree ("userId","revokedAt");--> statement-breakpoint
CREATE INDEX "UserBlock_blockerId_idx" ON "UserBlock" USING btree ("blockerId");--> statement-breakpoint
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock" USING btree ("blockedId");--> statement-breakpoint
CREATE INDEX "UserBlock_createdAt_idx" ON "UserBlock" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "UserInteraction_npcId_timestamp_idx" ON "UserInteraction" USING btree ("npcId","timestamp");--> statement-breakpoint
CREATE INDEX "UserInteraction_userId_npcId_timestamp_idx" ON "UserInteraction" USING btree ("userId","npcId","timestamp");--> statement-breakpoint
CREATE INDEX "UserInteraction_userId_timestamp_idx" ON "UserInteraction" USING btree ("userId","timestamp");--> statement-breakpoint
CREATE INDEX "UserMute_muterId_idx" ON "UserMute" USING btree ("muterId");--> statement-breakpoint
CREATE INDEX "UserMute_mutedId_idx" ON "UserMute" USING btree ("mutedId");--> statement-breakpoint
CREATE INDEX "UserMute_createdAt_idx" ON "UserMute" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "UserPnLSnapshot_userId_snapshotAt_idx" ON "UserPnLSnapshot" USING btree ("userId","snapshotAt");--> statement-breakpoint
CREATE INDEX "UserPnLSnapshot_snapshotAt_idx" ON "UserPnLSnapshot" USING btree ("snapshotAt");--> statement-breakpoint
CREATE INDEX "User_displayName_idx" ON "User" USING btree ("displayName");--> statement-breakpoint
CREATE INDEX "User_earnedPoints_idx" ON "User" USING btree ("earnedPoints");--> statement-breakpoint
CREATE INDEX "User_invitePoints_idx" ON "User" USING btree ("invitePoints");--> statement-breakpoint
CREATE INDEX "User_isActor_idx" ON "User" USING btree ("isActor");--> statement-breakpoint
CREATE INDEX "User_createdAt_idx" ON "User" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "User_isActor_createdAt_idx" ON "User" USING btree ("isActor","createdAt");--> statement-breakpoint
CREATE INDEX "User_isAgent_idx" ON "User" USING btree ("isAgent");--> statement-breakpoint
CREATE INDEX "User_isAgent_createdAt_idx" ON "User" USING btree ("isAgent","createdAt");--> statement-breakpoint
CREATE INDEX "User_isAgent_managedBy_idx" ON "User" USING btree ("isAgent","managedBy");--> statement-breakpoint
CREATE INDEX "User_isBanned_isActor_idx" ON "User" USING btree ("isBanned","isActor");--> statement-breakpoint
CREATE INDEX "User_isScammer_idx" ON "User" USING btree ("isScammer");--> statement-breakpoint
CREATE INDEX "User_isCSAM_idx" ON "User" USING btree ("isCSAM");--> statement-breakpoint
CREATE INDEX "User_managedBy_idx" ON "User" USING btree ("managedBy");--> statement-breakpoint
CREATE INDEX "User_managedBy_isAgent_createdAt_idx" ON "User" USING btree ("managedBy","isAgent","createdAt");--> statement-breakpoint
CREATE INDEX "User_profileComplete_createdAt_idx" ON "User" USING btree ("profileComplete","createdAt");--> statement-breakpoint
CREATE INDEX "User_referralCode_idx" ON "User" USING btree ("referralCode");--> statement-breakpoint
CREATE INDEX "User_lifetimePnL_createdAt_id_idx" ON "User" USING btree ("lifetimePnL","createdAt","id");--> statement-breakpoint
CREATE INDEX "User_reputationPoints_idx" ON "User" USING btree ("reputationPoints");--> statement-breakpoint
CREATE INDEX "User_username_idx" ON "User" USING btree ("username");--> statement-breakpoint
CREATE INDEX "User_emailNotificationsEnabled_idx" ON "User" USING btree ("emailNotificationsEnabled");--> statement-breakpoint
CREATE INDEX "User_waitlistJoinedAt_idx" ON "User" USING btree ("waitlistJoinedAt");--> statement-breakpoint
CREATE INDEX "User_waitlistPosition_idx" ON "User" USING btree ("waitlistPosition");--> statement-breakpoint
CREATE INDEX "User_walletAddress_idx" ON "User" USING btree ("walletAddress");--> statement-breakpoint
CREATE INDEX "User_registrationIpHash_idx" ON "User" USING btree ("registrationIpHash");--> statement-breakpoint
CREATE INDEX "User_lastReferralIpHash_idx" ON "User" USING btree ("lastReferralIpHash");--> statement-breakpoint
CREATE INDEX "User_dailyLoginStreak_idx" ON "User" USING btree ("dailyLoginStreak");--> statement-breakpoint
CREATE INDEX "User_longestStreak_idx" ON "User" USING btree ("longestStreak");--> statement-breakpoint
CREATE INDEX "User_lastDailyLogin_idx" ON "User" USING btree ("lastDailyLogin");--> statement-breakpoint
CREATE INDEX "WalletTransferLog_userId_idx" ON "WalletTransferLog" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "WalletTransferLog_userId_createdAt_idx" ON "WalletTransferLog" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "WalletTransferLog_fromAddress_idx" ON "WalletTransferLog" USING btree ("fromAddress");--> statement-breakpoint
CREATE INDEX "WalletTransferLog_toAddress_idx" ON "WalletTransferLog" USING btree ("toAddress");--> statement-breakpoint
CREATE INDEX "WalletTransferLog_txHash_idx" ON "WalletTransferLog" USING btree ("txHash");--> statement-breakpoint
CREATE INDEX "WalletTransferLog_status_idx" ON "WalletTransferLog" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Whitelist_userId_idx" ON "Whitelist" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Whitelist_source_idx" ON "Whitelist" USING btree ("source");--> statement-breakpoint
CREATE INDEX "Whitelist_revokedAt_idx" ON "Whitelist" USING btree ("revokedAt");--> statement-breakpoint
CREATE INDEX "idx_memories_type_room" ON "memories" USING btree ("type","room_id");--> statement-breakpoint
CREATE INDEX "idx_memories_world_id" ON "memories" USING btree ("world_id");--> statement-breakpoint
CREATE INDEX "idx_memories_metadata_type" ON "memories" USING btree (((metadata->>'type')));--> statement-breakpoint
CREATE INDEX "idx_memories_document_id" ON "memories" USING btree (((metadata->>'documentId')));--> statement-breakpoint
CREATE INDEX "idx_fragments_order" ON "memories" USING btree (((metadata->>'documentId')),((metadata->>'position')));--> statement-breakpoint
CREATE INDEX "idx_participants_user" ON "participants" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_participants_room" ON "participants" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "idx_relationships_users" ON "relationships" USING btree ("source_entity_id","target_entity_id");