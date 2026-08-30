-- Execute no SQL Editor do Supabase para habilitar a troca obrigatória de senha.
-- Alunos já cadastrados continuam com a senha atual. Novos alunos e senhas
-- restauradas pelo administrador passam a exigir a alteração no primeiro acesso.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Garante uma senha inicial para cadastros feitos por upsert e corrige dados
-- legados antes de tornar a coluna obrigatoria.
UPDATE students SET password = '1234' WHERE password IS NULL;
ALTER TABLE students ALTER COLUMN password SET DEFAULT '1234';
ALTER TABLE students ALTER COLUMN password SET NOT NULL;
