-- Core Values Seed (production-safe — these are Touchcore's actual values)
INSERT INTO core_values (name, slug, definition, icon, accent_color, display_order) VALUES
('Adaptable',     'adaptable',     'Adjusts positively and effectively to changing requirements, priorities, technologies, situations and business needs.', 'refresh-cw', '#2A6EA8', 1),
('Transparent',   'transparent',   'Communicates openly, honestly and responsibly.',                                                                       'eye',        '#5B6B78', 2),
('Collaborative', 'collaborative', 'Works effectively with others and prioritizes collective success.',                                                     'users',      '#BE3A66', 3),
('Innovative',    'innovative',    'Challenges existing approaches and creates better ways of working.',                                                    'lightbulb',  '#A25A0B', 4),
('Accountable',   'accountable',   'Takes ownership of commitments, responsibilities, actions and outcomes.',                                              'check-circle','#C42A20', 5)
ON CONFLICT (slug) DO NOTHING;

-- Behaviours for Adaptable
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Quickly adapts to changing client requirements', 'Responds effectively when client needs shift mid-project', 1 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Learns new tools or processes', 'Proactively picks up new technology or methodology', 2 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Remains effective during uncertainty', 'Maintains quality output when circumstances are unclear', 3 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Helps others adapt to change', 'Supports colleagues through transitions and new processes', 4 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Adjusts priorities when business needs change', 'Reprioritises workload in response to business direction', 5 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;

-- Behaviours for Transparent
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Shares important information proactively', 'Does not wait to be asked — surfaces relevant information early', 1 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Communicates risks early', 'Flags blockers and risks before they escalate', 2 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Owns mistakes', 'Acknowledges errors and takes responsibility', 3 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Gives honest and constructive feedback', 'Shares views directly and with respect', 4 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Communicates clearly with stakeholders', 'Keeps stakeholders informed with clear and timely updates', 5 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;

-- Behaviours for Collaborative
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Supports colleagues', 'Goes beyond their role to help others succeed', 1 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Shares knowledge', 'Actively shares expertise with the team', 2 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Helps solve cross-functional problems', 'Contributes beyond team boundaries to solve shared problems', 3 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Gives credit to others', 'Recognizes and acknowledges the contribution of colleagues', 4 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Prioritizes team success', 'Puts collective outcomes above individual recognition', 5 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;

-- Behaviours for Innovative
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Introduces new solutions', 'Brings fresh approaches to persistent problems', 1 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Automates repetitive work', 'Identifies and eliminates manual, time-consuming processes', 2 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Suggests process improvements', 'Proactively proposes ways to work better', 3 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Experiments with technology', 'Tries new tools and approaches to find better outcomes', 4 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Challenges inefficient processes constructively', 'Raises process problems with proposed alternatives', 5 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;

-- Behaviours for Accountable
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Delivers on commitments', 'Follows through on what was agreed, on time', 1 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Takes responsibility for mistakes', 'Owns errors without deflecting blame', 2 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Escalates risks appropriately', 'Raises blockers to the right person at the right time', 3 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Takes ownership beyond immediate responsibilities', 'Steps in when something needs doing even if not explicitly their role', 4 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Keeps stakeholders informed', 'Provides timely updates without being asked', 5 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;

-- ============================================================
-- SCENARIO SEED DATA
-- One scenario file is inserted per behaviour.
-- All scenarios have "A different situation" as fallback via
-- the frontend (not stored in DB — always shown in Step 4).
-- ============================================================

-- Scenarios for Adaptable → Quickly adapts to changing client requirements
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Client changed requirements mid-sprint', 'Scope or requirements changed after development had started', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Quickly adapts to changing client requirements'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Emergency pivot due to business change', 'The business direction changed and required a rapid response', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Quickly adapts to changing client requirements'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Last-minute client feedback incorporated', 'Client provided feedback close to deadline that required changes', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Quickly adapts to changing client requirements'
ON CONFLICT DO NOTHING;

-- Scenarios for Adaptable → Learns new tools or processes
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Picked up a new technology for a project', 'The project required a tool or language not previously used', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Learns new tools or processes'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Adopted a new internal process or methodology', 'A new way of working was introduced and adopted quickly', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Learns new tools or processes'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Self-taught a skill to unblock the team', 'Learned independently to remove a blocker for the wider team', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Learns new tools or processes'
ON CONFLICT DO NOTHING;

-- Scenarios for Transparent → Communicates risks early
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Flagged a delivery risk before it escalated', 'Raised a potential problem early enough for the team to act', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Communicates risks early'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Raised a technical concern during planning', 'Highlighted a technical risk at the design or planning stage', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Communicates risks early'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Proactively flagged a dependency risk', 'Identified and communicated a third-party or team dependency risk', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Communicates risks early'
ON CONFLICT DO NOTHING;

-- Scenarios for Transparent → Shares important information proactively
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Shared critical update without being asked', 'Surfaced important information before stakeholders requested it', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Shares important information proactively'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Kept the team informed during a difficult situation', 'Maintained clear and regular communication during uncertainty', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Shares important information proactively'
ON CONFLICT DO NOTHING;

-- Scenarios for Collaborative → Helps solve cross-functional problems
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Resolved a cross-team technical blocker', 'Helped another team unblock a technical issue that was holding them back', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Supported another team during a critical deadline', 'Stepped in to help a different team meet a time-sensitive delivery', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Volunteered expertise to another department', 'Shared specialist knowledge with colleagues outside their own team', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Helped bridge a communication gap between teams', 'Facilitated understanding between two groups who were misaligned', 4
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

-- Scenarios for Collaborative → Supports colleagues
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Mentored or onboarded a new team member', 'Invested time helping someone new get up to speed', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Supports colleagues'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Stepped in to support an overwhelmed colleague', 'Helped a team member who was struggling with workload or complexity', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Supports colleagues'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Provided support during a difficult project phase', 'Offered help during a high-pressure or challenging time', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Supports colleagues'
ON CONFLICT DO NOTHING;

-- Scenarios for Collaborative → Shares knowledge
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Ran a knowledge sharing session or brown-bag', 'Organized or led a session to share expertise with the wider team', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Shares knowledge'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Documented process or knowledge for the team', 'Created documentation that reduced knowledge silos', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Shares knowledge'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Proactively shared expertise in code review or design', 'Offered knowledge and guidance during technical review', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Shares knowledge'
ON CONFLICT DO NOTHING;

-- Scenarios for Innovative → Introduces new solutions
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Proposed a better technical architecture or approach', 'Suggested a fundamentally different way to build or solve something', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Introduces new solutions'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Introduced a new tool or technology that improved outcomes', 'Brought in a tool that meaningfully improved quality or speed', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Introduces new solutions'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Found a creative solution to a persistent problem', 'Resolved a long-standing challenge with a fresh approach', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Introduces new solutions'
ON CONFLICT DO NOTHING;

-- Scenarios for Innovative → Automates repetitive work
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Automated a manual, time-consuming process', 'Built a script, tool, or workflow that eliminated repetitive manual work', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Automates repetitive work'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Created a reusable tool or template for the team', 'Built something that saves time for the whole team, not just themselves', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Automates repetitive work'
ON CONFLICT DO NOTHING;

-- Scenarios for Accountable → Delivers on commitments
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Delivered on time despite unexpected challenges', 'Met a commitment even when obstacles arose during the work', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Delivers on commitments'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Took on additional responsibility and followed through', 'Voluntarily took ownership of more and delivered on it', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Delivers on commitments'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Delivered a high-quality result under pressure', 'Maintained quality and met commitments in a high-pressure situation', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Delivers on commitments'
ON CONFLICT DO NOTHING;

-- Scenarios for Accountable → Takes responsibility for mistakes
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Owned a production issue and led the resolution', 'Took full ownership of a live problem and drove it to resolution', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Takes responsibility for mistakes'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Acknowledged an error and took corrective action', 'Proactively admitted a mistake and made it right', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Takes responsibility for mistakes'
ON CONFLICT DO NOTHING;

-- Scenarios for Accountable → Escalates risks appropriately
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Escalated a risk at exactly the right time', 'Raised a concern to the right person at the right moment', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Escalates risks appropriately'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Flagged a compliance or legal risk proactively', 'Identified and escalated a risk with regulatory or legal implications', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Escalates risks appropriately'
ON CONFLICT DO NOTHING;
