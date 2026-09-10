-- Execute uma vez no SQL Editor do Supabase para corrigir tabelas antigas.
-- Versões antigas do portal podiam ter `title` obrigatório em activities,
-- enquanto o painel atual salva o campo `name`.

ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS files JSONB DEFAULT '[]'::jsonb;

-- Mantém os dados já existentes e permite que novas atividades usem `name`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activities' AND column_name = 'title'
  ) THEN
    EXECUTE 'UPDATE public.activities SET name = COALESCE(NULLIF(name, ''''), title) WHERE name IS NULL OR name = ''''';
    EXECUTE 'ALTER TABLE public.activities ALTER COLUMN title DROP NOT NULL';
  END IF;
END $$;

UPDATE public.activities
SET name = 'Atividade sem nome'
WHERE name IS NULL OR btrim(name) = '';

ALTER TABLE public.activities ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO anon, authenticated;

DROP POLICY IF EXISTS portal_activities_full_access ON public.activities;
CREATE POLICY portal_activities_full_access ON public.activities
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
