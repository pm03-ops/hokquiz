-- =====================================================================
-- Create a TEST staff account (run AFTER creating the auth user in
-- Authentication → Users with email h0001@clinic.local).
-- must_change_password = true → we get to test the first-login flow.
-- Idempotent. Change the values if you want a different test user.
-- =====================================================================
insert into public.profiles (id, employee_id, name, role, must_change_password)
select id, 'H0001', '測試照服員', 'care', true
from auth.users
where lower(email) = 'h0001@clinic.local'
on conflict (id) do update
  set employee_id          = 'H0001',
      name                 = '測試照服員',
      role                 = 'care',
      must_change_password = true;

-- Verify: should now show H1974 (admin) and H0001 (care)
select employee_id, name, role, must_change_password
from public.profiles order by role;
