-- ============================================================
-- DEVELOPMENT SEED DATA ONLY
-- Do NOT run this in production
-- Contains fictional employees, departments, projects, and 
-- enough recognition data to demonstrate all features
-- ============================================================

-- Departments
INSERT INTO departments (id, name, description) VALUES
('dept-0001-0000-0000-000000000001', 'Engineering',      'Software engineering and platform'),
('dept-0002-0000-0000-000000000001', 'Product',          'Product management and design'),
('dept-0003-0000-0000-000000000001', 'Client Services',  'Client engagement and delivery'),
('dept-0004-0000-0000-000000000001', 'Operations',       'Internal operations and people'),
('dept-0005-0000-0000-000000000001', 'Sales',            'Business development and sales')
ON CONFLICT DO NOTHING;

-- Projects
INSERT INTO projects (id, name, description, project_code, is_active) VALUES
('proj-0001-0000-0000-000000000001', 'ABC Client Portal',       'Customer portal for ABC Ltd',          'PROJ-ABC',  true),
('proj-0002-0000-0000-000000000001', 'Internal Platform v2',    'Touchcore internal tools upgrade',     'PROJ-INT2', true),
('proj-0003-0000-0000-000000000001', 'XYZ Analytics Dashboard', 'BI dashboard for XYZ Corp',            'PROJ-XYZ',  true),
('proj-0004-0000-0000-000000000001', 'DEF Mobile App',          'React Native app for DEF client',      'PROJ-DEF',  true),
('proj-0005-0000-0000-000000000001', 'HR Digital Transformation','Internal HR process automation',      'PROJ-HRD',  true)
ON CONFLICT DO NOTHING;

-- Employees (no auth_user_id — will be linked when test users are created via Supabase Auth)
-- Super Admin
INSERT INTO employees (id, employee_id, full_name, email, role, department_id, is_active) VALUES
('emp-0001-0000-0000-000000000001', 'TC001', 'Admin User',     'admin@test.com', 'super_admin', NULL, true)
ON CONFLICT DO NOTHING;

-- HR Admin
INSERT INTO employees (id, employee_id, full_name, email, role, department_id, is_active) VALUES
('emp-0002-0000-0000-000000000001', 'TC002', 'Meera Nair',      'hr@test.com',       'hr_admin',  'dept-0004-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;

-- Managers
INSERT INTO employees (id, employee_id, full_name, email, role, department_id, is_active) VALUES
('emp-0003-0000-0000-000000000001', 'TC003', 'Rohan Desai',     'manager@test.com',  'manager',   'dept-0001-0000-0000-000000000001', true),
('emp-0004-0000-0000-000000000001', 'TC004', 'Sunita Rao',      'sunita@test.com',   'manager',   'dept-0002-0000-0000-000000000001', true),
('emp-0005-0000-0000-000000000001', 'TC005', 'Vikram Mehta',    'vikram@test.com',   'manager',   'dept-0003-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;

-- Employees
INSERT INTO employees (id, employee_id, full_name, email, role, department_id, manager_id, is_active) VALUES
('emp-0006-0000-0000-000000000001', 'TC006', 'Amit Sharma',     'employee@test.com', 'employee',  'dept-0001-0000-0000-000000000001', 'emp-0003-0000-0000-000000000001', true),
('emp-0007-0000-0000-000000000001', 'TC007', 'Priya Patel',     'priya@test.com',    'employee',  'dept-0001-0000-0000-000000000001', 'emp-0003-0000-0000-000000000001', true),
('emp-0008-0000-0000-000000000001', 'TC008', 'Kavya Reddy',     'kavya@test.com',    'employee',  'dept-0002-0000-0000-000000000001', 'emp-0004-0000-0000-000000000001', true),
('emp-0009-0000-0000-000000000001', 'TC009', 'Arjun Nair',      'arjun@test.com',    'employee',  'dept-0002-0000-0000-000000000001', 'emp-0004-0000-0000-000000000001', true),
('emp-0010-0000-0000-000000000001', 'TC010', 'Deepak Kumar',    'deepak@test.com',   'employee',  'dept-0003-0000-0000-000000000001', 'emp-0005-0000-0000-000000000001', true),
('emp-0011-0000-0000-000000000001', 'TC011', 'Ananya Singh',    'ananya@test.com',   'employee',  'dept-0003-0000-0000-000000000001', 'emp-0005-0000-0000-000000000001', true),
('emp-0012-0000-0000-000000000001', 'TC012', 'Rahul Gupta',     'rahul@test.com',    'employee',  'dept-0001-0000-0000-000000000001', 'emp-0003-0000-0000-000000000001', true),
('emp-0013-0000-0000-000000000001', 'TC013', 'Shruti Iyer',     'shruti@test.com',   'employee',  'dept-0004-0000-0000-000000000001', 'emp-0002-0000-0000-000000000001', true),
('emp-0014-0000-0000-000000000001', 'TC014', 'Nikhil Joshi',    'nikhil@test.com',   'employee',  'dept-0005-0000-0000-000000000001', NULL,                             true),
('emp-0015-0000-0000-000000000001', 'TC015', 'Pooja Verma',     'pooja@test.com',    'employee',  'dept-0001-0000-0000-000000000001', 'emp-0003-0000-0000-000000000001', true),
('emp-0016-0000-0000-000000000001', 'TC016', 'Kiran Bhat',      'kiran@test.com',    'employee',  'dept-0002-0000-0000-000000000001', 'emp-0004-0000-0000-000000000001', true),
('emp-0017-0000-0000-000000000001', 'TC017', 'Sneha Pillai',    'sneha@test.com',    'employee',  'dept-0003-0000-0000-000000000001', 'emp-0005-0000-0000-000000000001', true),
('emp-0018-0000-0000-000000000001', 'TC018', 'Ravi Shankar',    'ravi@test.com',     'employee',  'dept-0004-0000-0000-000000000001', 'emp-0002-0000-0000-000000000001', true),
('emp-0019-0000-0000-000000000001', 'TC019', 'Lakshmi Das',     'lakshmi@test.com',  'employee',  'dept-0005-0000-0000-000000000001', NULL,                             true),
('emp-0020-0000-0000-000000000001', 'TC020', 'Aditya Bansal',   'aditya@test.com',   'employee',  'dept-0001-0000-0000-000000000001', 'emp-0003-0000-0000-000000000001', true)
ON CONFLICT DO NOTHING;

-- Note: auth_user_id will be set when you create test users in Supabase Auth dashboard
-- and link them by updating: UPDATE employees SET auth_user_id = '<supabase_auth_id>' WHERE email = '...'
