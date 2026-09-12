-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'BOOKKEEPER', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "SalesChannelKind" AS ENUM ('SHOPIFY', 'TIKTOK_SHOP', 'INSTAGRAM', 'ETSY', 'AMAZON', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'BANK', 'INVOICE', 'BILL', 'PAYOUT', 'ORDER', 'PAYROLL', 'OPENING', 'MIGRATION');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED', 'VARIANCE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "legacy_mongo_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "system_key" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "SalesChannelKind" NOT NULL,
    "name" TEXT NOT NULL,
    "fee_model" JSONB,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "status" "EntryStatus" NOT NULL DEFAULT 'POSTED',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "source" "EntrySource" NOT NULL,
    "external_ref" TEXT,
    "reverses_entry_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "channel_id" UUID,
    "is_bank_side" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel_id" UUID,
    "processor" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "fees_minor" BIGINT NOT NULL,
    "refunds_minor" BIGINT NOT NULL DEFAULT 0,
    "adjustments_minor" BIGINT NOT NULL DEFAULT 0,
    "expected_net_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "arrival_date" DATE NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_legacy_mongo_id_key" ON "users"("legacy_mongo_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "accounts_organization_id_type_idx" ON "accounts"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_system_key_key" ON "accounts"("organization_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_code_key" ON "accounts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_channels_organization_id_name_key" ON "sales_channels"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_entry_id_key" ON "journal_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_date_id_idx" ON "journal_entries"("organization_id", "date" DESC, "id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_status_idx" ON "journal_entries"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_source_external_ref_key" ON "journal_entries"("organization_id", "source", "external_ref");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_organization_id_account_id_idx" ON "journal_lines"("organization_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_lines_organization_id_channel_id_idx" ON "journal_lines"("organization_id", "channel_id");

-- CreateIndex
CREATE INDEX "payouts_organization_id_status_arrival_date_idx" ON "payouts"("organization_id", "status", "arrival_date");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_organization_id_processor_external_id_key" ON "payouts"("organization_id", "processor", "external_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "sales_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Ledger invariants (hand-written; appended to the generated migration).
-- These are the rules the database enforces regardless of application bugs
-- (ADR 0001, ADR 0004). Keep them in sync with docs/ledger.md.
-- ---------------------------------------------------------------------------

-- 1. Each line has exactly one positive side; amounts are never negative.
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_side_positive"
  CHECK (
    "debit_minor" >= 0 AND "credit_minor" >= 0
    AND (("debit_minor" > 0) <> ("credit_minor" > 0))
  );

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_position_nonnegative" CHECK ("position" >= 0);

-- 2. A POSTED (or REVERSED) entry's debits equal its credits, checked at
--    commit (deferred) so lines can be inserted one statement at a time.
CREATE OR REPLACE FUNCTION ledger_assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id uuid;
  v_status "EntryStatus";
  v_debit bigint;
  v_credit bigint;
  v_lines int;
BEGIN
  IF TG_TABLE_NAME = 'journal_lines' THEN
    v_entry_id := COALESCE(NEW."entry_id", OLD."entry_id");
  ELSE
    v_entry_id := COALESCE(NEW."id", OLD."id");
  END IF;

  SELECT "status" INTO v_status FROM "journal_entries" WHERE "id" = v_entry_id;
  IF v_status IS NULL THEN
    RETURN NULL; -- entry deleted in this transaction; nothing to check
  END IF;
  IF v_status NOT IN ('POSTED', 'REVERSED') THEN
    RETURN NULL; -- drafts and discarded entries may be unbalanced
  END IF;

  SELECT COALESCE(SUM("debit_minor"), 0), COALESCE(SUM("credit_minor"), 0), COUNT(*)
    INTO v_debit, v_credit, v_lines
    FROM "journal_lines" WHERE "entry_id" = v_entry_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'ledger: entry % needs at least two lines (has %)', v_entry_id, v_lines
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'ledger: entry % does not balance (debits % vs credits %)', v_entry_id, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "journal_lines_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_entry_balanced();

CREATE CONSTRAINT TRIGGER "journal_entries_balanced"
  AFTER INSERT OR UPDATE OF "status" ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_entry_balanced();

-- 3. Locked entries are immutable except for the transition to REVERSED
--    (a reversal is the sanctioned correction). Entry dates never change
--    once posted; use reverse + re-post.
CREATE OR REPLACE FUNCTION ledger_guard_entry_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."locked" THEN
    IF NEW."status" = 'REVERSED' AND OLD."status" = 'POSTED'
       AND NEW."locked" = OLD."locked"
       AND NEW."date" = OLD."date"
       AND NEW."organization_id" = OLD."organization_id"
       AND NEW."source" = OLD."source"
       AND NEW."external_ref" IS NOT DISTINCT FROM OLD."external_ref" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ledger: entry % is locked', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('POSTED', 'REVERSED') AND NEW."date" <> OLD."date" THEN
    RAISE EXCEPTION 'ledger: the date of posted entry % cannot change; reverse and re-post', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."organization_id" <> OLD."organization_id" THEN
    RAISE EXCEPTION 'ledger: entries cannot move between organizations' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_entries_guard_update"
  BEFORE UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard_entry_update();

CREATE OR REPLACE FUNCTION ledger_guard_entry_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."locked" THEN
    RAISE EXCEPTION 'ledger: entry % is locked and cannot be deleted', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'ledger: posted entry % cannot be deleted; reverse it', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "journal_entries_guard_delete"
  BEFORE DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard_entry_delete();

-- 4. Lines of a locked entry are immutable; bank-side lines of a posted entry
--    never change amount, account, or side (ADR 0004). Non-bank lines of an
--    unlocked posted entry may be replaced (recategorize / split).
CREATE OR REPLACE FUNCTION ledger_guard_line_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_locked boolean;
  v_status "EntryStatus";
  v_entry uuid;
BEGIN
  v_entry := COALESCE(OLD."entry_id", NEW."entry_id");
  SELECT "locked", "status" INTO v_locked, v_status FROM "journal_entries" WHERE "id" = v_entry;

  IF TG_OP = 'INSERT' THEN
    IF v_locked THEN
      RAISE EXCEPTION 'ledger: entry % is locked', v_entry USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF v_locked THEN
    RAISE EXCEPTION 'ledger: entry % is locked', v_entry USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."is_bank_side" AND v_status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'ledger: bank-side line % of posted entry % cannot be deleted', OLD."id", v_entry
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW."entry_id" <> OLD."entry_id" OR NEW."organization_id" <> OLD."organization_id" THEN
    RAISE EXCEPTION 'ledger: lines cannot move between entries or organizations' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."is_bank_side" AND v_status IN ('POSTED', 'REVERSED') THEN
    IF NEW."debit_minor" <> OLD."debit_minor" OR NEW."credit_minor" <> OLD."credit_minor"
       OR NEW."account_id" <> OLD."account_id" OR NEW."currency" <> OLD."currency"
       OR NEW."is_bank_side" <> OLD."is_bank_side" THEN
      RAISE EXCEPTION 'ledger: bank-side line % of posted entry % is immutable', OLD."id", v_entry
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journal_lines_guard_change"
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard_line_change();

-- 5. Money sanity on payouts.
ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amounts_nonnegative"
  CHECK ("gross_minor" >= 0 AND "fees_minor" >= 0 AND "refunds_minor" >= 0);

-- 6. Currency codes are upper-case ISO 4217.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_currency_upper" CHECK ("currency" = upper("currency"));
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_currency_upper" CHECK ("currency" = upper("currency"));
