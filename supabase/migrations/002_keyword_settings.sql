-- DayBrief subscriber keyword settings
-- The subscriber ID is not authenticated.
-- This table is accessed only by the development API.

CREATE TABLE IF NOT EXISTS public.user_keyword_settings (
    user_id TEXT PRIMARY KEY,
    keywords TEXT[] NOT NULL DEFAULT '{}'
);

-- Prevent direct client access through the public API roles.
ALTER TABLE public.user_keyword_settings
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_keyword_settings
FROM anon, authenticated;

-- No client-facing RLS policies are defined.
-- The backend uses a server-side secret key.
