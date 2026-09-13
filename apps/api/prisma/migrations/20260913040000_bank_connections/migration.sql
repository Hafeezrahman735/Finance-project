-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "connection_id" UUID,
ADD COLUMN     "external_id" TEXT;

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_item_id" TEXT NOT NULL,
    "institution_id" TEXT,
    "institution_name" TEXT NOT NULL,
    "access_token_ciphertext" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "sync_cursor" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "pending_external_id" TEXT,
    "date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "entry_id" UUID,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_connections_organization_id_idx" ON "bank_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_provider_provider_item_id_key" ON "bank_connections"("provider", "provider_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_entry_id_key" ON "bank_transactions"("entry_id");

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_bank_account_id_date_idx" ON "bank_transactions"("organization_id", "bank_account_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_connection_id_external_id_key" ON "bank_transactions"("connection_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_connection_id_external_id_key" ON "bank_accounts"("connection_id", "external_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bank_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

