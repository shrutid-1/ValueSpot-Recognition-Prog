---
inclusion: always
---

# Touchcore ValueSpot — Product Principles

These principles govern every product and engineering decision. Read them before writing any feature.

## P1: This is NOT a performance management system

Recognition frequency is NOT a performance score. Badges measure recognition frequency for a specific Core Value — nothing more.

- Never use: Rating, Performance Score, Top Performer, Best Employee, Winner
- Use: Recognition, Core Value, Behaviour, Impact, Value Badge, Recognition Leader, Most Recognized

Badge count must NEVER appear in any performance evaluation context. Never connect recognition data to salary, appraisal, or ranking logic.

## P2: Make recognition easy and meaningful

The recognition wizard must be completable in under 60 seconds on mobile.

- Every step must have clear purpose
- Placeholder text must be genuinely helpful
- Progress must be clearly communicated
- Validation errors must be specific and human

## P3: No hard-coded business data

Badge thresholds, financial year config, rate limits, and recognition counts are ALWAYS fetched from the database.

If you ever find yourself writing `if (count >= 16) badge = 'Value Ambassador'` in frontend code, stop. Fetch it from `badge_definitions`.

## P4: Privacy is non-negotiable

Employees must NEVER see:
- Their own rejection reason
- Other employees' pending/rejected nominations
- Reciprocal recognition flags
- Audit logs
- HR analytics

Build each feature with the question: "What would an employee see if they called this API directly?"

## P5: Historical data is sacred

If an employee changes department, manager, project, or role — historical recognitions must remain accurate. Use snapshot fields on the `nominations` table. Never reconstruct history from current relationships.

## P6: Recognition ≠ Competition

Do not create public leaderboards. The goal is celebration, not competition.

Monthly/quarterly/annual leaders are HR analytics tools, not employee-facing rankings.

## P7: Behaviour-first recognition

Every recognition must be anchored to a specific Core Value and behaviour. This is what makes recognition meaningful rather than vague.

Guide users to describe what happened AND the impact. Both fields are required.
