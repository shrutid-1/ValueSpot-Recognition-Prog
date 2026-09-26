-- Badge Definitions Seed (production-safe, always needed)
INSERT INTO badge_definitions (level, name, description, minimum_count, maximum_count, icon, accent_color, display_order) VALUES
(1, 'Cheers',           'A Core Value behaviour has been recognized.',              1,  2,    'star',    '#E05A4E', 1),
(2, 'Applause',         'The behaviour is being recognized repeatedly.',            3,  5,    'thumbs-up','#D13A2E', 2),
(3, 'Kudos',            'Strong recurring recognition.',                            6,  10,   'award',   '#C42A20', 3),
(4, 'Spotlight',        'Consistent recognition for the Core Value.',              11,  15,   'zap',     '#A2211A', 4),
(5, 'Value Ambassador', 'Strong and sustained recognition for the Core Value.',   16,  NULL, 'trophy',  '#7C1913', 5)
ON CONFLICT (level) DO NOTHING;
