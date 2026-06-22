-- Authentication schema for Neon PostgreSQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_auth_users_email_verified_at ON auth_users (email_verified_at);

CREATE TABLE IF NOT EXISTS auth_email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auth_email_verifications ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE auth_email_verifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE auth_email_verifications ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ NULL;
ALTER TABLE auth_email_verifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_auth_email_verifications_user_id ON auth_email_verifications (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_email_verifications_expires_at ON auth_email_verifications (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_email_verifications_token_hash ON auth_email_verifications (token_hash);

CREATE TABLE IF NOT EXISTS auth_media_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  media_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  original_size BIGINT NOT NULL DEFAULT 0,
  compressed_size BIGINT NULL,
  output_filename TEXT NULL,
  output_format TEXT NULL,
  source_pathname TEXT NULL,
  result_pathname TEXT NULL,
  source_url TEXT NULL,
  result_url TEXT NULL,
  compression_ratio DOUBLE PRECISION NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS original_name TEXT;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS original_size BIGINT NOT NULL DEFAULT 0;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS compressed_size BIGINT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS output_filename TEXT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS output_format TEXT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS source_pathname TEXT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS result_pathname TEXT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS source_url TEXT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS result_url TEXT NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS compression_ratio DOUBLE PRECISION NULL;
ALTER TABLE auth_media_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  ALTER TABLE auth_media_history
    ADD CONSTRAINT auth_media_history_event_type_check
    CHECK (event_type IN ('upload', 'compress'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE auth_media_history
    ADD CONSTRAINT auth_media_history_media_type_check
    CHECK (media_type IN ('image', 'video', 'unknown'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_auth_media_history_user_created_at ON auth_media_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_media_history_user_event_created_at ON auth_media_history (user_id, event_type, created_at DESC);
