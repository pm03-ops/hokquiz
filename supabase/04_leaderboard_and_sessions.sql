-- =====================================================================
-- Phase 1c: leaderboard view + per-attempt session ids
-- Run in Supabase → SQL Editor. Idempotent.
-- =====================================================================

-- Leaderboard: safe columns for all staff, readable only when logged in.
-- Owned by postgres so it can read profiles past RLS; the auth.uid() guard
-- ensures anonymous callers get zero rows even if a default grant leaks.
create or replace view public.leaderboard as
  select p.id, p.name, p.role, p.points, p.streak, p.answered
  from public.profiles p
  where p.role <> 'admin'
    and auth.uid() is not null;

revoke all on public.leaderboard from anon;
grant select on public.leaderboard to authenticated;

-- Session ids group the answers of a single quiz attempt so the server can
-- compute the attempt score from what it actually graded (unforgeable).
alter table public.answers  add column if not exists session_id uuid;
alter table public.attempts add column if not exists session_id uuid;
