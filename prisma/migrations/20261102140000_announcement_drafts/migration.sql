CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "announcement"
  ADD COLUMN "status" "AnnouncementStatus" NOT NULL DEFAULT 'PUBLISHED';
