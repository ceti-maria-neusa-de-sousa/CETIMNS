-- Checklists por setor para o portal CETI.
-- Execute uma vez no SQL Editor do Supabase.

create table if not exists public.sector_checklists (
  id uuid primary key default gen_random_uuid(),
  sector text not null check (sector in ('secretaria', 'cozinha', 'servicos_gerais', 'professores', 'alunos')),
  title text not null,
  description text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.sector_checklists add column if not exists location text;
alter table public.sector_checklists add column if not exists weekdays jsonb not null default '[1,2,3,4,5]'::jsonb;

create table if not exists public.sector_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.sector_checklists(id) on delete cascade,
  label text not null,
  position integer not null default 0
);

create table if not exists public.sector_checklist_completions (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.sector_checklists(id) on delete cascade,
  item_id uuid not null references public.sector_checklist_items(id) on delete cascade,
  user_id text not null,
  user_role text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  unique (item_id, user_id, user_role)
);
alter table public.sector_checklist_completions add column if not exists completed_on date;
update public.sector_checklist_completions set completed_on = coalesce(completed_on, (completed_at at time zone 'America/Sao_Paulo')::date, current_date);
alter table public.sector_checklist_completions alter column completed_on set not null;
alter table public.sector_checklist_completions drop constraint if exists sector_checklist_completions_item_id_user_id_user_role_key;
create unique index if not exists sector_checklist_completions_daily_unique on public.sector_checklist_completions(item_id, user_id, user_role, completed_on);

create table if not exists public.sector_checklist_assignees (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.sector_checklists(id) on delete cascade,
  user_id text not null,
  user_role text not null check (user_role in ('teacher', 'staff')),
  unique (checklist_id, user_id, user_role)
);

-- Ponto eletrônico simplificado para professores e funcionários do portal.
create table if not exists public.attendance_time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  user_role text not null check (user_role in ('admin', 'teacher', 'staff')),
  event_type text not null check (event_type in ('entry', 'exit')),
  recorded_at timestamptz not null default now()
);
alter table public.attendance_time_entries drop constraint if exists attendance_time_entries_event_type_check;
alter table public.attendance_time_entries add constraint attendance_time_entries_event_type_check check (event_type in ('entry', 'exit'));
create index if not exists attendance_time_entries_user_date_idx on public.attendance_time_entries(user_id, recorded_at desc);

alter table public.sector_checklists enable row level security;
alter table public.sector_checklist_items enable row level security;
alter table public.sector_checklist_completions enable row level security;
alter table public.sector_checklist_assignees enable row level security;
alter table public.attendance_time_entries enable row level security;

drop policy if exists sector_checklists_full_access on public.sector_checklists;
drop policy if exists sector_checklist_items_full_access on public.sector_checklist_items;
drop policy if exists sector_checklist_completions_full_access on public.sector_checklist_completions;
drop policy if exists sector_checklist_assignees_full_access on public.sector_checklist_assignees;
drop policy if exists attendance_time_entries_full_access on public.attendance_time_entries;
create policy sector_checklists_full_access on public.sector_checklists for all to anon using (true) with check (true);
create policy sector_checklist_items_full_access on public.sector_checklist_items for all to anon using (true) with check (true);
create policy sector_checklist_completions_full_access on public.sector_checklist_completions for all to anon using (true) with check (true);
create policy sector_checklist_assignees_full_access on public.sector_checklist_assignees for all to anon using (true) with check (true);
create policy attendance_time_entries_full_access on public.attendance_time_entries for all to anon using (true) with check (true);
