-- AlterTable
-- Credentials are now managed by Supabase Auth (auth.users), not this table.
ALTER TABLE "users" DROP COLUMN "password_hash";
