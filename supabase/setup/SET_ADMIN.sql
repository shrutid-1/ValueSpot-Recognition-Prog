-- ============================================================
--  Make a named account the Super Admin. Set the address on line 11 first.
--
--  Paste into the Supabase SQL Editor and press Run.
--  To use a different address, change it in BOTH lines below.
-- ============================================================

-- Promote your real account.
UPDATE employees
   SET role = 'super_admin', is_active = true
 WHERE lower(email) = 'CHANGE_ME@example.com';

-- Drop the test account back to an ordinary employee, so a throwaway
-- login is not left holding the highest privilege in the system.
UPDATE employees
   SET role = 'employee'
 WHERE lower(email) = 'employee@test.com';

-- Show the result.
SELECT full_name, email, role, is_active,
       (auth_user_id IS NOT NULL) AS can_sign_in
  FROM employees
 ORDER BY CASE role WHEN 'super_admin' THEN 1 WHEN 'hr_admin' THEN 2
                    WHEN 'manager' THEN 3 ELSE 4 END, email;
