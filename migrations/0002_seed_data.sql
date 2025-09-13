-- 0002_seed_data.sql
-- Seed data for Athlete Management System (demo)
-- Note: Assumes the schema from 0001_init_schema.sql has been applied.
BEGIN;

-- Seed user roles
INSERT INTO user_role (id, code, name) VALUES
  ('939a9c40-3b4a-4b7b-8b5e-14300a6e8f42', 'admin', 'Administrator') ON CONFLICT DO NOTHING,
  ('d88f619a-9e5c-4b5b-8f3a-69486c4a3d4f', 'coach', 'Coach') ON CONFLICT DO NOTHING,
  ('e3a9c7b0-1f9e-4b4e-98b4-83955d5b12a8', 'physio', 'Physiotherapist') ON CONFLICT DO NOTHING,
  ('f7c3b9d1-8b2c-4b3c-9b8a-11270e5f2a1d', 'parent', 'Parent/Guardian') ON CONFLICT DO NOTHING,
  ('a5b7d9f2-0c1d-4b8a-9c7d-30485f6a9c8d', 'athlete', 'Athlete') ON CONFLICT DO NOTHING;

-- Seed institutions
INSERT INTO institution (id, name, address, timezone) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Starlight High School', '123 Main St, City', 'Asia/Kolkata') ON CONFLICT DO NOTHING,
  ('22222222-2222-2222-2222-222222222222', 'Riverside Academy', '45 River Rd, City', 'Asia/Kolkata') ON CONFLICT DO NOTHING;

-- Seed sports
INSERT INTO sport (id, institution_id, code, name) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'football', 'Football') ON CONFLICT DO NOTHING,
  ('aaaa0000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'athletics', 'Athletics') ON CONFLICT DO NOTHING,
  ('aaaa0000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'basketball', 'Basketball') ON CONFLICT DO NOTHING;

-- Seed app users (coaches/admins/physio)
INSERT INTO app_user (id, institution_id, email, full_name, role_id, phone, password_hash) VALUES
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin@starlight.edu', 'Anjali Menon', (SELECT id FROM user_role WHERE code='admin' LIMIT 1), '9000000001', '$2b$12$R.vL705qKz1qg3.x5.d5C.m8s/L2kQ.3d5L14W/4W.b.L.q.b.g.L.q.b.'),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'coach.raj@starlight.edu', 'Raj Kapoor', (SELECT id FROM user_role WHERE code='coach' LIMIT 1), '9000000002', '$2b$12$R.vL705qKz1qg3.x5.d5C.m8s/L2kQ.3d5L14W/4W.b.L.q.b.g.L.q.b.'),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'physio.nita@starlight.edu', 'Nita Sharma', (SELECT id FROM user_role WHERE code='physio' LIMIT 1), '9000000003', '$2b$12$R.vL705qKz1qg3.x5.d5C.m8s/L2kQ.3d5L14W/4W.b.L.q.b.g.L.q.b.'),
  ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'admin@riverside.edu', 'Vikram Patel', (SELECT id FROM user_role WHERE code='admin' LIMIT 1), '9000000011', '$2b$12$R.vL705qKz1qg3.x5.d5C.m8s/L2kQ.3d5L14W/4W.b.L.q.b.g.L.q.b.'),
  ('20000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'coach.leo@riverside.edu', 'Leo Fernandes', (SELECT id FROM user_role WHERE code='coach' LIMIT 1), '9000000012', '$2b$12$R.vL705qKz1qg3.x5.d5C.m8s/L2kQ.3d5L14W/4W.b.L.q.b.g.L.q.b.');

-- Seed athletes
INSERT INTO athlete (id, institution_id, user_id, first_name, last_name, dob, gender, primary_sport_id, grade, emergency_contact) VALUES
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL, 'Aman', 'Sharma', '2008-05-12', 'male', 'aaaa0000-0000-4000-8000-000000000001', '10', '{"name":"Ramesh Sharma","relation":"Father","phone":"9000000101"}'),
  ('30000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL, 'Priya', 'Kaur', '2009-09-03', 'female', 'aaaa0000-0000-4000-8000-000000000002', '9', '{"name":"Sarita Kaur","relation":"Mother","phone":"9000000102"}'),
  ('30000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', NULL, 'Rohit', 'Singh', '2007-12-21', 'male', 'aaaa0000-0000-4000-8000-000000000003', '11', '{"name":"Sunita Singh","relation":"Mother","phone":"9000000111"}');

-- Seed teams
INSERT INTO team (id, institution_id, name, sport_id, season) VALUES
  ('40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Starlight U16 Football', 'aaaa0000-0000-4000-8000-000000000001', '2025-26'),
  ('40000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Riverside Senior Basketball', 'aaaa0000-0000-4000-8000-000000000003', '2025-26');

-- Seed roster entries
INSERT INTO roster (id, team_id, athlete_id, jersey_no, role, joined_at) VALUES
  (gen_random_uuid(), '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '9', 'forward', '2024-07-01'),
  (gen_random_uuid(), '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '7', 'midfielder', '2024-07-01'),
  (gen_random_uuid(), '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', '12', 'center', '2023-09-01');

-- Seed session
INSERT INTO session (id, team_id, coach_id, title, start_ts, end_ts, location, notes) VALUES
  (gen_random_uuid(), '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Morning Speed Session', '2025-09-14 06:30:00+05:30', '2025-09-14 08:00:00+05:30', 'Main Field', 'Warm up + sprint drills'),
  (gen_random_uuid(), '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Evening Skills', '2025-09-14 17:00:00+05:30', '2025-09-14 18:30:00+05:30', 'Indoor Court', 'Shooting & defense');

-- Seed attendance (present / absent)
INSERT INTO attendance (id, session_id, athlete_id, status, recorded_by, recorded_at) VALUES
  (gen_random_uuid(), (SELECT id FROM session WHERE team_id='40000000-0000-0000-0000-000000000001' LIMIT 1), '30000000-0000-0000-0000-000000000001', 'present', '10000000-0000-0000-0000-000000000002', NOW()),
  (gen_random_uuid(), (SELECT id FROM session WHERE team_id='40000000-0000-0000-0000-000000000001' LIMIT 1), '30000000-0000-0000-0000-000000000002', 'present', '10000000-0000-0000-0000-000000000002', NOW());

-- Seed assessment types
INSERT INTO assessment_type (id, institution_id, name, code, unit) VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '40m Sprint', '40m_sprint', 'seconds'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'Yo-Yo Test', 'yo_yo', 'level');

-- Seed assessment results
INSERT INTO assessment_result (id, athlete_id, assessment_type_id, value, notes, recorded_by, recorded_at) VALUES
  (gen_random_uuid(), '30000000-0000-0000-0000-000000000001', (SELECT id FROM assessment_type WHERE code='40m_sprint' LIMIT 1), 5.85, 'baseline', '10000000-0000-0000-0000-000000000002', NOW()),
  (gen_random_uuid(), '30000000-0000-0000-0000-000000000002', (SELECT id FROM assessment_type WHERE code='40m_sprint' LIMIT 1), 6.10, 'baseline', '10000000-0000-0000-0000-000000000002', NOW());

-- Seed injury
INSERT INTO injury (id, athlete_id, reported_by, description, diagnosis, date_reported, status, restricted) VALUES
  (gen_random_uuid(), '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'Mild hamstring strain', 'Hamstring strain (grade 1)', '2025-06-01', 'open', TRUE);

COMMIT;
