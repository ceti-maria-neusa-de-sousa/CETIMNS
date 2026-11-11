-- Portal interno para funcionários e notificações privadas.
-- Execute este arquivo no SQL Editor do Supabase uma única vez.

CREATE TABLE IF NOT EXISTS staff (
  id TEXT DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('secretaria', 'cozinha', 'servicos_gerais')),
  user TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  recipient_id TEXT,
  recipient_role TEXT,
  recipient_sector TEXT,
  recipient_student_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (recipient_id IS NOT NULL OR recipient_role IS NOT NULL OR recipient_sector IS NOT NULL)
);

-- Compatibilidade com instalações que executaram uma versão anterior deste arquivo.
ALTER TABLE private_notifications
  ADD COLUMN IF NOT EXISTS recipient_student_id TEXT;
ALTER TABLE private_notifications DROP CONSTRAINT IF EXISTS private_notifications_check;
ALTER TABLE private_notifications
  ADD CONSTRAINT private_notifications_check CHECK (
    recipient_id IS NOT NULL OR recipient_role IS NOT NULL OR recipient_sector IS NOT NULL OR recipient_student_id IS NOT NULL
  );

CREATE TABLE IF NOT EXISTS sector_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sector TEXT NOT NULL CHECK (sector IN ('secretaria', 'cozinha', 'servicos_gerais')),
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kitchen_menu (
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
ALTER TABLE kitchen_menu ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE kitchen_menu ADD COLUMN IF NOT EXISTS actual_meal TEXT;
CREATE TABLE IF NOT EXISTS kitchen_stock (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT,
  minimum_quantity NUMERIC NOT NULL DEFAULT 0,
  expiry_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dietary_restrictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_name TEXT NOT NULL,
  student_id TEXT,
  class_name TEXT,
  restriction TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, requester_id TEXT, requester_name TEXT NOT NULL, requester_role TEXT,
  subject TEXT NOT NULL, message TEXT NOT NULL, reply TEXT, status TEXT DEFAULT 'Aberto', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS student_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, student_id TEXT NOT NULL, document_type TEXT NOT NULL,
  file JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE dietary_restrictions ADD COLUMN IF NOT EXISTS student_id TEXT;

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE dietary_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_full_access ON staff FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY private_notifications_full_access ON private_notifications FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY sector_records_full_access ON sector_records FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY kitchen_menu_full_access ON kitchen_menu FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY kitchen_stock_full_access ON kitchen_stock FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY dietary_restrictions_full_access ON dietary_restrictions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY support_requests_full_access ON support_requests FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY student_documents_full_access ON student_documents FOR ALL TO anon USING (true) WITH CHECK (true);
