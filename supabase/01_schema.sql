-- =====================================================================
-- 照護學堂 線上測驗平台 · Supabase schema (Phase 1)
-- Run this in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: uses "if not exists" / "or replace" where possible.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- profiles: one row per staff member, keyed to auth.users.
-- employee_id is the H#### the staff actually type; the auth email is the
-- hidden synthetic address (H1234@clinic.local) and never shown.
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  employee_id           text unique not null,                 -- 'H1234'
  name                  text not null,
  role                  text not null default 'care'
                          check (role in ('care','social','nurse','admin')),
  points                integer not null default 0,
  streak                integer not null default 0,
  last_active           date,
  answered              integer not null default 0,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now()
);

create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  descr       text default '',
  emoji       text default '📘',
  roles       text[] not null default '{}',                   -- which roles may see it
  created_at  timestamptz not null default now()
);

create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  stem         text not null,
  correct      text not null,          -- NEVER exposed to non-admin clients
  distractors  text[] not null default '{}',
  explain      text default '',        -- NEVER exposed until after grading
  created_at   timestamptz not null default now()
);

create table if not exists public.attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  score       integer not null,
  total       integer not null,
  points      integer not null default 0,
  device_id   text,                    -- per-browser id, for anomaly review (no IP)
  at          timestamptz not null default now()
);

create table if not exists public.answers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  correct      boolean not null,
  device_id    text,
  at           timestamptz not null default now()
);

create table if not exists public.reviews (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  level        integer not null default 0,
  due          integer not null default 0,   -- day-number (Date/86400000)
  primary key (user_id, question_id)
);

create table if not exists public.badge_defs (
  key    text primary key,
  emoji  text not null,
  name   text not null
);

create table if not exists public.user_badges (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  badge_key text not null references public.badge_defs(key) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_key)
);

-- ---------------------------------------------------------------------
-- Helper: current caller's app role (security definer bypasses RLS so
-- it can read profiles without recursing into profiles' own policies)
-- ---------------------------------------------------------------------
create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- Enable Row Level Security on every table
-- ---------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.quizzes     enable row level security;
alter table public.questions   enable row level security;
alter table public.attempts    enable row level security;
alter table public.answers     enable row level security;
alter table public.reviews     enable row level security;
alter table public.badge_defs  enable row level security;
alter table public.user_badges enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_admin());

-- staff may update ONLY their own row; gamification columns are written
-- by the grade-answer Edge Function (service role), not here.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- quizzes ----------
drop policy if exists quizzes_select_role on public.quizzes;
create policy quizzes_select_role on public.quizzes
  for select using (public.is_admin() or roles && array[public.auth_role()]);

drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_admin_write on public.quizzes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- questions ----------
-- Only admins can touch the base table (they need correct/explain to edit).
-- Non-admin staff read questions through the questions_public VIEW below,
-- which omits correct/explain. No non-admin select policy = table hidden.
drop policy if exists questions_admin_all on public.questions;
create policy questions_admin_all on public.questions
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- attempts / answers ----------
-- Clients may READ their own; only the service role (Edge Function) writes.
drop policy if exists attempts_select_own_or_admin on public.attempts;
create policy attempts_select_own_or_admin on public.attempts
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists answers_select_own_or_admin on public.answers;
create policy answers_select_own_or_admin on public.answers
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------- reviews (SRS): user's own study schedule, not sensitive ----------
drop policy if exists reviews_own on public.reviews;
create policy reviews_own on public.reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- badges ----------
drop policy if exists badge_defs_read on public.badge_defs;
create policy badge_defs_read on public.badge_defs
  for select using (auth.role() = 'authenticated');

drop policy if exists user_badges_select_own_or_admin on public.user_badges;
create policy user_badges_select_own_or_admin on public.user_badges
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- questions_public VIEW — what non-admin clients read.
-- Exposes stem + shuffled options (correct mixed in, UNLABELLED); never
-- correct/explain. Owned by postgres, so it can read the base table even
-- though staff cannot; it applies its own role filter.
-- ---------------------------------------------------------------------
create or replace view public.questions_public as
  select
    q.id,
    q.quiz_id,
    q.stem,
    ( select array_agg(o order by random())
      from unnest(q.distractors || array[q.correct]) as o ) as options
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id
  where public.is_admin() or z.roles && array[public.auth_role()];

-- Lock down direct access; expose only the view to logged-in users.
revoke all on public.questions from anon, authenticated;
grant select on public.questions_public to authenticated;

-- ---------------------------------------------------------------------
-- Seed the badge definitions (matches the old db.js badgeDefs)
-- ---------------------------------------------------------------------
insert into public.badge_defs (key, emoji, name) values
  ('first',   '🌱', '初次作答'),
  ('streak7', '🔥', '連續7天'),
  ('perfect', '💯', '單次滿分'),
  ('century', '🏅', '答對100題')
on conflict (key) do nothing;
