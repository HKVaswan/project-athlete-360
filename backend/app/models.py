# backend/app/models.py

from sqlalchemy import Column, String, Boolean, Date, DateTime, ForeignKey, JSON, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.db import Base

# -------------------------------
# User Roles
# -------------------------------
class UserRole(Base):
    __tablename__ = "user_role"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    users = relationship("AppUser", back_populates="role")

# -------------------------------
# Institutions
# -------------------------------
class Institution(Base):
    __tablename__ = "institution"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    address = Column(String)
    timezone = Column(String, default="Asia/Kolkata")
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    users = relationship("AppUser", back_populates="institution")
    sports = relationship("Sport", back_populates="institution")
    teams = relationship("Team", back_populates="institution")

# -------------------------------
# Users
# -------------------------------
class AppUser(Base):
    __tablename__ = "app_user"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id = Column(UUID(as_uuid=True), ForeignKey("institution.id"))
    email = Column(String, unique=True, nullable=False)
    full_name = Column(String, nullable=False)
    role_id = Column(UUID(as_uuid=True), ForeignKey("user_role.id"))
    phone = Column(String)
    password = Column(String)
    is_active = Column(Boolean, default=True)
    settings = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    role = relationship("UserRole", back_populates="users")
    institution = relationship("Institution", back_populates="users")
    athletes = relationship("Athlete", back_populates="user")
    sessions = relationship("Session", back_populates="coach")

# -------------------------------
# Sports
# -------------------------------
class Sport(Base):
    __tablename__ = "sport"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id = Column(UUID(as_uuid=True), ForeignKey("institution.id"))
    code = Column(String, unique=True)
    name = Column(String, nullable=False)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    institution = relationship("Institution", back_populates="sports")
    athletes = relationship("Athlete", back_populates="primary_sport")
    teams = relationship("Team", back_populates="sport")

# -------------------------------
# Athletes
# -------------------------------
class Athlete(Base):
    __tablename__ = "athlete"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id = Column(UUID(as_uuid=True), ForeignKey("institution.id"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String)
    dob = Column(Date)
    gender = Column(String)
    photo_url = Column(String)
    primary_sport_id = Column(UUID(as_uuid=True), ForeignKey("sport.id"))
    grade = Column(String)
    emergency_contact = Column(JSON)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("AppUser", back_populates="athletes")
    primary_sport = relationship("Sport", back_populates="athletes")
    rosters = relationship("Roster", back_populates="athlete")
    attendances = relationship("Attendance", back_populates="athlete")
    assessments = relationship("AssessmentResult", back_populates="athlete")
    injuries = relationship("Injury", back_populates="athlete")

# -------------------------------
# Teams
# -------------------------------
class Team(Base):
    __tablename__ = "team"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id = Column(UUID(as_uuid=True), ForeignKey("institution.id"))
    name = Column(String, nullable=False)
    sport_id = Column(UUID(as_uuid=True), ForeignKey("sport.id"))
    season = Column(String)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    institution = relationship("Institution", back_populates="teams")
    sport = relationship("Sport", back_populates="teams")
    rosters = relationship("Roster", back_populates="team")
    sessions = relationship("Session", back_populates="team")

# -------------------------------
# Roster
# -------------------------------
class Roster(Base):
    __tablename__ = "roster"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(UUID(as_uuid=True), ForeignKey("team.id"))
    athlete_id = Column(UUID(as_uuid=True), ForeignKey("athlete.id"))
    jersey_no = Column(String)
    role = Column(String)
    joined_at = Column(Date)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("Team", back_populates="rosters")
    athlete = relationship("Athlete", back_populates="rosters")

# -------------------------------
# Sessions
# -------------------------------
class Session(Base):
    __tablename__ = "session"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team_id = Column(UUID(as_uuid=True), ForeignKey("team.id"))
    coach_id = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    title = Column(String)
    start_ts = Column(DateTime, nullable=False)
    end_ts = Column(DateTime)
    location = Column(String)
    notes = Column(String)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("Team", back_populates="sessions")
    coach = relationship("AppUser", back_populates="sessions")
    attendances = relationship("Attendance", back_populates="session")

# -------------------------------
# Attendance
# -------------------------------
class Attendance(Base):
    __tablename__ = "attendance"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("session.id"))
    athlete_id = Column(UUID(as_uuid=True), ForeignKey("athlete.id"))
    status = Column(String)
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    recorded_at = Column(DateTime, default=datetime.utcnow)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("Session", back_populates="attendances")
    athlete = relationship("Athlete", back_populates="attendances")

# -------------------------------
# Assessment Types
# -------------------------------
class AssessmentType(Base):
    __tablename__ = "assessment_type"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    institution_id = Column(UUID(as_uuid=True), ForeignKey("institution.id"))
    name = Column(String, nullable=False)
    code = Column(String)
    unit = Column(String)
    normative_ranges = Column(JSON)
    config = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    results = relationship("AssessmentResult", back_populates="assessment_type")

# -------------------------------
# Assessment Results
# -------------------------------
class AssessmentResult(Base):
    __tablename__ = "assessment_result"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id = Column(UUID(as_uuid=True), ForeignKey("athlete.id"))
    assessment_type_id = Column(UUID(as_uuid=True), ForeignKey("assessment_type.id"))
    value = Column(Float, nullable=False)
    notes = Column(String)
    recorded_at = Column(DateTime, default=datetime.utcnow)
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    athlete = relationship("Athlete", back_populates="assessments")
    assessment_type = relationship("AssessmentType", back_populates="results")

# -------------------------------
# Injuries
# -------------------------------
class Injury(Base):
    __tablename__ = "injury"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id = Column(UUID(as_uuid=True), ForeignKey("athlete.id"))
    reported_by = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    description = Column(String)
    diagnosis = Column(String)
    date_reported = Column(Date)
    status = Column(String)
    restricted = Column(Boolean, default=False)
    metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    athlete = relationship("Athlete", back_populates="injuries")