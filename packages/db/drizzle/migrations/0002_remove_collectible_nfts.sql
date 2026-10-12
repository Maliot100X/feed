ALTER TABLE "NftClaim" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "NftCollection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "NftOwnership" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "NftSnapshot" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "NftClaim" CASCADE;--> statement-breakpoint
DROP TABLE "NftCollection" CASCADE;--> statement-breakpoint
DROP TABLE "NftOwnership" CASCADE;--> statement-breakpoint
DROP TABLE "NftSnapshot" CASCADE;--> statement-breakpoint
DROP INDEX "Chat_nftGated_idx";--> statement-breakpoint
DROP INDEX "Chat_requiredNftContractAddress_idx";--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN "requiredNftContractAddress";--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN "requiredNftTokenId";--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN "requiredNftChainId";--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN "nftGated";--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN "lastNftRevalidatedAt";--> statement-breakpoint
ALTER TABLE "WalletTransferLog" DROP COLUMN "tokenId";