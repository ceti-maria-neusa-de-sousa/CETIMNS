-- Cria as tabelas ainda ausentes no projeto Supabase do CETI.
-- Seguro para executar mais de uma vez no SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.kitchen_menu (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_date DATE NOT NULL,
  meal TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  prepared_at TIMESTAMPTZ,
  prepared_by TEXT,
  status TEXT,
  actual_meal TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kitchen_stock (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT,
  minimum_quantity NUMERIC NOT NULL DEFAULT 0,
  expiry_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dietary_restrictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_name TEXT NOT NULL,
  student_id TEXT,
  class_name TEXT,
  restriction TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id TEXT,
  requester_name TEXT NOT NULL,
  requester_role TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  attachment JSONB,
  reply TEXT,
  status TEXT NOT NULL DEFAULT 'Aberto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  file JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_requests ADD COLUMN IF NOT EXISTS attachment JSONB;
ALTER TABLE public.dietary_restrictions ADD COLUMN IF NOT EXISTS student_id TEXT;

ALTER TABLE public.kitchen_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dietary_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kitchen_menu, public.kitchen_stock,
  public.dietary_restrictions, public.support_requests, public.student_documents
  TO anon, authenticated;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'kitchen_menu', 'kitchen_stock', 'dietary_restrictions',
    'support_requests', 'student_documents'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_full_access', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      table_name || '_full_access', table_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
