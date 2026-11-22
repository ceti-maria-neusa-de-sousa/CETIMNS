-- Módulo seguro de gestão de funcionários do CETI.
-- Execute no SQL Editor do Supabase ANTES de publicar a Edge Function.
-- Esta migração não altera ou remove as tabelas legadas.

create extension if not exists pgcrypto;

create table if not exists public.workforce_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  legacy_staff_id text unique references public.staff(id) on delete set null,
  display_name text not null,
  role text not null check (role in ('director', 'teacher', 'staff')),
  sector text check (sector in ('secretaria', 'cozinha', 'servicos_gerais', 'vigia', 'pedagogico', 'outro')),
  job_title text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.workforce_profiles(auth_user_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  break_starts_at time,
  break_ends_at time,
  ends_at time not null,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.workforce_profiles(auth_user_id) on delete restrict,
  event_type text not null check (event_type in ('entry', 'break_start', 'break_end', 'exit')),
  recorded_at timestamptz not null default now(),
  source text not null default 'employee' check (source in ('employee', 'director_correction')),
  justification text,
  corrected_entry_id uuid references public.time_entries(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  sector text,
  instructions text,
  active boolean not null default true,
  created_by uuid not null references public.workforce_profiles(auth_user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  label text not null,
  field_type text not null check (field_type in ('checkbox', 'text', 'number', 'select', 'date', 'time', 'image', 'file')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  position integer not null default 0
);

create table if not exists public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'gerais' check (category in ('administrativas', 'pedagogicas', 'limpeza', 'secretaria', 'seguranca', 'manutencao', 'gerais')),
  sector text,
  template_id uuid references public.checklist_templates(id) on delete set null,
  starts_at timestamptz,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('baixa', 'normal', 'alta', 'urgente')),
  status text not null default 'published' check (status in ('draft', 'published', 'cancelled')),
  proof_required boolean not null default false,
  created_by uuid not null references public.workforce_profiles(auth_user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete cascade,
  profile_id uuid not null references public.workforce_profiles(auth_user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'returned', 'overdue')),
  completed_at timestamptz,
  notes text,
  proof jsonb,
  unique (task_id, profile_id)
);

create table if not exists public.checklist_submissions (
  id uuid primary key default gen_random_uuid(),
  task_assignee_id uuid not null unique references public.work_task_assignees(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  observations text,
  attachments jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now()
);

create table if not exists public.workforce_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.workforce_profiles(auth_user_id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists time_entries_profile_recorded_at_idx on public.time_entries(profile_id, recorded_at desc);
create index if not exists work_tasks_due_at_idx on public.work_tasks(due_at);
create index if not exists work_task_assignees_profile_status_idx on public.work_task_assignees(profile_id, status);

alter table public.workforce_profiles enable row level security;
alter table public.work_schedules enable row level security;
alter table public.time_entries enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_fields enable row level security;
alter table public.work_tasks enable row level security;
alter table public.work_task_assignees enable row level security;
alter table public.checklist_submissions enable row level security;
alter table public.workforce_audit_log enable row level security;

create or replace function public.is_workforce_director()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workforce_profiles where auth_user_id = auth.uid() and role = 'director' and active);
$$;

create or replace function public.record_own_time_event(p_event_type text, p_justification text default null)
returns public.time_entries language plpgsql security definer set search_path = public as $$
declare profile public.workforce_profiles; previous text; expected text; result public.time_entries;
begin
  select * into profile from public.workforce_profiles where auth_user_id = auth.uid() and active;
  if profile.auth_user_id is null then raise exception 'Perfil de funcionário ativo não encontrado'; end if;
  select event_type into previous from public.time_entries where profile_id = auth.uid() and (recorded_at at time zone 'America/Fortaleza')::date = (now() at time zone 'America/Fortaleza')::date order by recorded_at desc limit 1;
  expected := case coalesce(previous, '') when '' then 'entry' when 'entry' then 'break_start' when 'break_start' then 'break_end' when 'break_end' then 'exit' else 'entry' end;
  if p_event_type <> expected then raise exception 'Marcação fora da sequência. Próxima marcação esperada: %', expected; end if;
  insert into public.time_entries(profile_id, event_type, justification) values (auth.uid(), p_event_type, nullif(trim(p_justification), '')) returning * into result;
  insert into public.workforce_audit_log(actor_id, action, entity_type, entity_id, after_data) values (auth.uid(), 'time_event_created', 'time_entries', result.id::text, to_jsonb(result));
  return result;
end;
$$;

-- Leitura própria; direção pode administrar todo o módulo. Nenhuma política anon é criada.
create policy workforce_profiles_self_or_director on public.workforce_profiles for select to authenticated using (auth_user_id = auth.uid() or public.is_workforce_director());
create policy schedules_self_or_director on public.work_schedules for select to authenticated using (profile_id = auth.uid() or public.is_workforce_director());
create policy schedules_director_manage on public.work_schedules for all to authenticated using (public.is_workforce_director()) with check (public.is_workforce_director());
create policy time_entries_self_or_director on public.time_entries for select to authenticated using (profile_id = auth.uid() or public.is_workforce_director());
create policy templates_visible_to_staff on public.checklist_templates for select to authenticated using (active or public.is_workforce_director());
create policy templates_director_manage on public.checklist_templates for all to authenticated using (public.is_workforce_director()) with check (public.is_workforce_director());
create policy fields_visible_to_staff on public.checklist_fields for select to authenticated using (true);
create policy fields_director_manage on public.checklist_fields for all to authenticated using (public.is_workforce_director()) with check (public.is_workforce_director());
create policy tasks_director_or_assignee on public.work_tasks for select to authenticated using (public.is_workforce_director() or exists (select 1 from public.work_task_assignees a where a.task_id = id and a.profile_id = auth.uid()));
create policy tasks_director_manage on public.work_tasks for all to authenticated using (public.is_workforce_director()) with check (public.is_workforce_director());
create policy assignees_director_or_self on public.work_task_assignees for select to authenticated using (profile_id = auth.uid() or public.is_workforce_director());
create policy assignees_self_update on public.work_task_assignees for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy assignees_director_manage on public.work_task_assignees for all to authenticated using (public.is_workforce_director()) with check (public.is_workforce_director());
create policy submissions_director_or_self on public.checklist_submissions for select to authenticated using (public.is_workforce_director() or exists (select 1 from public.work_task_assignees a where a.id = task_assignee_id and a.profile_id = auth.uid()));
create policy submissions_self_insert on public.checklist_submissions for insert to authenticated with check (exists (select 1 from public.work_task_assignees a where a.id = task_assignee_id and a.profile_id = auth.uid()));
create policy audit_director_read on public.workforce_audit_log for select to authenticated using (public.is_workforce_director());

revoke all on function public.is_workforce_director() from public;
grant execute on function public.is_workforce_director() to authenticated;
revoke all on function public.record_own_time_event(text, text) from public;
grant execute on function public.record_own_time_event(text, text) to authenticated;
