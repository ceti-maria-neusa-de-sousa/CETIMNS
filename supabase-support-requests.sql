-- Execute este arquivo no SQL Editor do Supabase para ativar o atendimento da Secretaria.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
ALTER TABLE public.support_requests ADD COLUMN IF NOT EXISTS attachment JSONB;
ALTER TABLE public.support_requests ADD COLUMN IF NOT EXISTS requester_contact TEXT;
ALTER TABLE public.support_requests ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.support_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  support_request_id UUID NOT NULL REFERENCES public.support_requests(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  attachment JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_body_or_attachment CHECK (length(trim(body)) > 0 OR attachment IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS support_messages_request_created_idx
  ON public.support_messages(support_request_id, created_at);

CREATE TABLE IF NOT EXISTS public.student_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  file JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_requests, public.support_messages, public.student_documents TO anon;

DROP POLICY IF EXISTS support_requests_full_access ON public.support_requests;
CREATE POLICY support_requests_full_access ON public.support_requests FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS support_messages_full_access ON public.support_messages;
CREATE POLICY support_messages_full_access ON public.support_messages FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS student_documents_full_access ON public.student_documents;
CREATE POLICY student_documents_full_access ON public.student_documents FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
