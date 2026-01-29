ALTER TABLE "Document" DROP COLUMN "content";

ALTER TABLE "DocumentVersion"
ADD COLUMN "summary" TEXT NOT NULL DEFAULT '';

ALTER TABLE "DocumentVersion"
ALTER COLUMN "summary" DROP DEFAULT;
