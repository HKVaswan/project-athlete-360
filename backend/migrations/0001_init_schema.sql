-- 0001_init_schema_updated.sql
-- SQL Migration: Schema for Athlete Management System (v1.2)
-- PostgreSQL, requires pgcrypto (gen_random_uuid)
-- Run: CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ===========================
-- Utility: trigger for updated_at
-- ===========================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- ===========================
-- Lookup: user roles
-- ===========================
CREATE TABLE IF NOT EXISTS user_role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_user_role_updated_at
BEFORE UPDATE ON user_role
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Institutions
-- ===========================
CREATE TABLE IF NOT EXISTS institution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_institution_updated_at
BEFORE UPDATE ON institution
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Users
-- ===========================
CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institution(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role_id UUID REFERENCES user_role(id),
  phone TEXT,
  password_hash TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure emails are unique ignoring case
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_lower ON app_user(LOWER(email));

CREATE TRIGGER tr_app_user_updated_at
BEFORE UPDATE ON app_user
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Athletes
-- ===========================
CREATE TABLE IF NOT EXISTS athlete (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institution(id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  dob DATE,
  gender TEXT CHECK (gender IN ('male','female','other')),
  photo_url TEXT,
  primary_sport_id UUID REFERENCES sport(id),
  grade TEXT,
  emergency_contact JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_athlete_updated_at
BEFORE UPDATE ON athlete
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Sports
-- ===========================
CREATE TABLE IF NOT EXISTS sport (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institution(id) ON DELETE CASCADE,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_sport_updated_at
BEFORE UPDATE ON sport
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Teams
-- ===========================
CREATE TABLE IF NOT EXISTS team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institution(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sport_id UUID REFERENCES sport(id),
  season TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_team_updated_at
BEFORE UPDATE ON team
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Roster
-- ===========================
CREATE TABLE IF NOT EXISTS roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES team(id) ON DELETE CASCADE,
  athlete_id UUID REFERENCES athlete(id) ON DELETE CASCADE,
  jersey_no TEXT,
  role TEXT,
  joined_at DATE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, athlete_id)
);

CREATE TRIGGER tr_roster_updated_at
BEFORE UPDATE ON roster
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Training Sessions
-- ===========================
CREATE TABLE IF NOT EXISTS session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES team(id) ON DELETE CASCADE,
  coach_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  title TEXT,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ,
  location TEXT,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_session_updated_at
BEFORE UPDATE ON session
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Attendance
-- ===========================
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES session(id) ON DELETE CASCADE,
  athlete_id UUID REFERENCES athlete(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('present','absent','injured','excused')),
  recorded_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, athlete_id)
);

CREATE TRIGGER tr_attendance_updated_at
BEFORE UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Assessment Types
-- ===========================
CREATE TABLE IF NOT EXISTS assessment_type (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institution(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  unit TEXT,
  normative_ranges JSONB,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_assessment_type_updated_at
BEFORE UPDATE ON assessment_type
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Assessment Results
-- ===========================
CREATE TABLE IF NOT EXISTS assessment_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athlete(id) ON DELETE CASCADE,
  assessment_type_id UUID REFERENCES assessment_type(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL,
  notes TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_assessment_result_updated_at
BEFORE UPDATE ON assessment_result
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Injuries
-- ===========================
CREATE TABLE IF NOT EXISTS injury (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athlete(id) ON DELETE CASCADE,
  reported_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  description TEXT,
  diagnosis TEXT,
  date_reported DATE NOT NULL,
  status TEXT CHECK (status IN ('open','recovered','chronic')),
  restricted BOOLEAN DEFAULT TRUE,
  documents JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_injury_updated_at
BEFORE UPDATE ON injury
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================
-- Audit Log
-- ===========================
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  institution_id UUID,
  table_name TEXT,
  record_id UUID,
  operation TEXT,
  changed_by UUID,
  change_time TIMESTAMPTZ DEFAULT NOW(),
  diff JSONB
);

-- ===========================
-- Indexes
-- ===========================
CREATE INDEX IF NOT EXISTS idx_athlete_institution ON athlete(institution_id);
CREATE INDEX IF NOT EXISTS idx_team_institution ON team(institution_id);
CREATE INDEX IF NOT EXISTS idx_assessment_athlete ON assessment_result(athlete_id);
CREATE INDEX IF NOT EXISTS idx_session_team ON session(team_id);

COMMIT;