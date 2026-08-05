-- =====================================================================
-- Bootstrap the first admin (run AFTER creating the auth user in
-- Authentication → Users with email h1974@clinic.local).
-- Idempotent: safe to re-run.
-- =====================================================================
insert into public.profiles (id, employee_id, name, role, must_change_password)
select id, 'H1974', '如廷', 'admin', false
from auth.users
where lower(email) = 'h1974@clinic.local'
on conflict (id) do update
  set employee_id          = excluded.employee_id,
      name                 = excluded.name,
      role                 = excluded.role,
      must_change_password = excluded.must_change_password;

-- Verify: should show one row → H1974 | 如廷 | admin
select employee_id, name, role, must_change_password
from public.profiles;
