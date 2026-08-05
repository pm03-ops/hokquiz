-- =====================================================================
-- Fix: 01_schema.sql did `revoke all on questions from authenticated`,
-- which also blocked ADMIN writes (RLS needs the table grant to exist).
-- Restore the grant; the questions_admin_all policy still limits real
-- access to admins, and non-admins get 0 rows (no select policy matches),
-- so correct/explain stay hidden from staff browsers.
-- Run in Supabase → SQL Editor.
-- =====================================================================
grant select, insert, update, delete on public.questions to authenticated;
