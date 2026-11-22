-- Execute este arquivo no SQL Editor do Supabase para permitir que cada
-- pessoa limpe apenas os próprios avisos, sem apagar os avisos dos demais.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.notification_dismissals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES public.private_notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notification_id, user_id, user_role)
);

ALTER TABLE public.notification_dismissals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_dismissals TO anon, authenticated;

DROP POLICY IF EXISTS notification_dismissals_full_access ON public.notification_dismissals;
CREATE POLICY notification_dismissals_full_access
  ON public.notification_dismissals FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
