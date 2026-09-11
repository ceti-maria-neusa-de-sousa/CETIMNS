-- Atualização para promoção de alunos e emissão de documentos de concluintes.
-- Execute uma vez no SQL Editor do Supabase.

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_graduated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS graduation_classname TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS graduation_date DATE;

-- Garante a remoção das notas quando um aluno é excluído, inclusive em bancos antigos.
ALTER TABLE public.grades DROP CONSTRAINT IF EXISTS grades_studentId_fkey;
ALTER TABLE public.grades
  ADD CONSTRAINT grades_studentId_fkey
  FOREIGN KEY ("studentId") REFERENCES public.students(id) ON DELETE CASCADE;
