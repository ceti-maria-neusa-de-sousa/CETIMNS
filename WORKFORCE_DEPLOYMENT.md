# Implantação segura do módulo de funcionários

Este módulo usa Supabase Auth e uma Edge Function. A chave `SUPABASE_SERVICE_ROLE_KEY` fica apenas no ambiente da função; ela nunca deve ser adicionada ao `app.js`, ao GitHub Pages ou a arquivos versionados.

## 1. Aplicar a migração

No SQL Editor do projeto Supabase, execute [supabase-workforce-module.sql](./supabase-workforce-module.sql). Ela cria perfis, escalas, tarefas, checklists, respostas e auditoria, todos protegidos por RLS para o papel `authenticated`.

## 2. Criar o primeiro diretor

No painel Authentication do Supabase, crie manualmente a conta do diretor. Depois, no SQL Editor, vincule-a ao perfil (substitua os valores):

```sql
insert into public.workforce_profiles (auth_user_id, display_name, role, active)
values ('UUID_DA_CONTA_AUTH', 'Nome do diretor', 'director', true);
```

Somente essa primeira vinculação é manual. Depois, a direção cria as demais contas pela função protegida.

## 3. Publicar a Edge Function

Com o Supabase CLI autenticado e vinculado ao projeto:

```powershell
supabase functions deploy manage-workforce
```

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente hospedado. Não crie uma versão delas com valores reais no repositório.

## 4. Transição de usuários existentes

Não migre senhas antigas por SQL nem por JavaScript. Para cada profissional, a direção cria uma conta Auth usando e-mail e senha temporária; a pessoa deve trocar a senha no primeiro acesso. Alunos continuam no fluxo atual enquanto sua migração não for planejada separadamente.

## Registro de jornada

O site não oferece nem utiliza registro de ponto. A tabela de eventos que possa existir em instalações antigas não aparece nos painéis do portal e não deve ser usada para controle de jornada.
