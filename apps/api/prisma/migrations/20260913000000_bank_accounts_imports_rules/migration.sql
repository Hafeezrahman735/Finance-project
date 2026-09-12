-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'MAPPED', 'COMMITTING', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'NEW', 'DUPLICATE', 'INVALID', 'SKIPPED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "RuleMatch" AS ENUM ('CONTAINS', 'EXACT', 'REGEX');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BankAccountKind" NOT NULL DEFAULT 'CHECKING',
    "account_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "mask" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "columns" JSONB NOT NULL,
    "mapping" JSONB,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "date" DATE,
    "description" TEXT,
    "amount_minor" BIGINT,
    "dedupe_hash" TEXT,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "problem" TEXT,
    "entry_id" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "match" "RuleMatch" NOT NULL DEFAULT 'CONTAINS',
    "pattern" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "channel_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_organization_id_name_key" ON "bank_accounts"("organization_id", "name");

-- CreateIndex
CREATE INDEX "imports_organization_id_created_at_idx" ON "imports"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_rows_organization_id_dedupe_hash_idx" ON "import_rows"("organization_id", "dedupe_hash");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_import_id_index_key" ON "import_rows"("import_id", "index");

-- CreateIndex
CREATE INDEX "category_rules_organization_id_priority_idx" ON "category_rules"("organization_id", "priority");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

