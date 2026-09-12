-- For an existing local PostgreSQL install (docs/setup.md#2-postgres). Run once as a superuser:
--   psql -U postgres -h localhost -f scripts/create-local-db.sql
-- Creates the app role and the dev + test databases. The password is for local development only.
CREATE ROLE ledgeriq LOGIN PASSWORD 'ledgeriq' CREATEDB;  -- CREATEDB: prisma migrate dev needs a shadow database
CREATE DATABASE ledgeriq OWNER ledgeriq;
CREATE DATABASE ledgeriq_test OWNER ledgeriq;
