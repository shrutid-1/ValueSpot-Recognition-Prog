-- App Configuration Seed (production-safe defaults)
INSERT INTO app_config (key, value, description) VALUES
('rate_limit_daily',            '5',                 'Max recognitions an employee can submit per day'),
('rate_limit_monthly',          '20',                'Max recognitions an employee can submit per month'),
('anti_gaming_window_days',     '30',                'Days before same nominator can have another approved recognition for same nominee + same Core Value'),
('duplicate_detection_hours',   '24',                'Hours to check for substantially similar recognition content'),
('badge_period_type',           '"annual"',          'Badge calculation period type'),
('badge_period_start_month',    '1',                 'Annual badge period start month (1=January)'),
('financial_year_q1_start',     '4',                 'Financial year Q1 start month (4=April)'),
('timezone',                    '"Asia/Kolkata"',     'Display timezone for all date/time values'),
('hr_fallback_employee_id',     'null',              'Employee ID to receive escalated approvals when no manager is found'),
('reciprocal_flag_threshold',   '3',                 'Number of reciprocal recognitions before creating an HR flag'),
('recognition_feed_page_size',  '20',                'Number of recognitions per page in the feed')
ON CONFLICT (key) DO NOTHING;
