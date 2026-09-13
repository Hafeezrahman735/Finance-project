-- CreateEnum
CREATE TYPE "InsightKind" AS ENUM ('WEEKLY_BRIEF');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('GENERATED', 'DEGRADED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "feature_flags" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "InsightKind" NOT NULL DEFAULT 'WEEKLY_BRIEF',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "InsightStatus" NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "raw_response" TEXT,
    "brief" JSONB NOT NULL,
    "degraded_reason" TEXT,
    "request_id" TEXT,
    "regenerations" INTEGER NOT NULL DEFAULT 0,
    "emailed_at" TIMESTAMPTZ(3),
    "first_opened_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_insights_organization_id_kind_period_start_key" ON "ai_insights"("organization_id", "kind", "period_start");

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

