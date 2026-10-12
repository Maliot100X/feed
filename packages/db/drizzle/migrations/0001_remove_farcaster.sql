ALTER TABLE "User" DROP CONSTRAINT "User_farcasterFid_unique";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "farcasterUsername";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "hasFarcaster";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "pointsAwardedForFarcaster";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "pointsAwardedForFarcasterFollow";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "showFarcasterPublic";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "farcasterDisplayName";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "farcasterFid";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "farcasterPfpUrl";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "farcasterVerifiedAt";