-- Execute no SQL Editor do Supabase para habilitar a troca obrigatória de senha.
-- Alunos já cadastrados continuam com a senha atual. Novos alunos e senhas
-- restauradas pelo administrador passam a exigir a alteração no primeiro acesso.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
