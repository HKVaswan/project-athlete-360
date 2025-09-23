# backend/app/models.py

from sqlalchemy import Column, String, Boolean, Date, DateTime, ForeignKey, JSON, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db import Base  # Make sure you have Base = declarative_base() in db.py

# -------------------------------
# Lookup: User Roles
# -------------------------------
class UserRole(Base):
    __tablename__ = "user_role"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    users = relationship("AppUser", back_populates="role")

# -------------------------------
# Institutions
# -------------------------------
class Institution(Base):
    __tablename__ = "institution"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    address = Column(Text)
    timezone = Column(String, default="Asia/Kolkata")
    metadata = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    password_hash = Column(String)
    is_active = Column(Boolean, default=True)
    settings = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    role = relationship("UserRole", back_populates="users")
    institution = relationship("Institution", back_populates="users")
    athletes = relationship("Athlete", back_populates="user")
    sessions = relationship("Session", back_populates="coach")
    assessment_results = relationship("AssessmentResult", back_populates="recorded_by_user")
    injuries_reported = relationship("Injury", back_populates="reported_by_user")

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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    user_id = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    first_name = Column(String, nullable=False)
    last_name = Column(String)
    dob = Column(Date)
    gender = Column(String)
    photo_url = Column(String)
    primary_sport_id = Column(UUID(as_uuid=True), ForeignKey("sport.id"))
    grade = Column(String)
    emergency_contact = Column(JSON)
    metadata = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    user = relationship("AppUser", back_populates="athletes")
    primary_sport = relationship("Sport", back_populates="athletes")
    rosters = relationship("Roster", back_populates="athlete")
    attendance_records = relationship("Attendance", back_populates="athlete")
    assessment_results = relationship("AssessmentResult", back_populates="athlete")
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    start_ts = Column(DateTime)
    end_ts = Column(DateTime)
    location = Column(String)
    notes = Column(Text)
    metadata = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    team = relationship("Team", back_populates="sessions")
    coach = relationship("AppUser", back_populates="sessions")
    attendance_records = relationship("Attendance", back_populates="session")

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
    recorded_at = Column(DateTime, server_default=func.now())
    metadata = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    session = relationship("Session", back_populates="attendance_records")
    athlete = relationship("Athlete", back_populates="attendance_records")
    recorder = relationship("AppUser", back_populates="attendance_records")

# -------------------------------
# Assessment Types & Results
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    results = relationship("AssessmentResult", back_populates="assessment_type")

class AssessmentResult(Base):
    __tablename__ = "assessment_result"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id = Column(UUID(as_uuid=True), ForeignKey("athlete.id"))
    assessment_type_id = Column(UUID(as_uuid=True), ForeignKey("assessment_type.id"))
    value = Column(Numeric, nullable=False)
    notes = Column(Text)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())
    recorded_by = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    metadata = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    athlete = relationship("Athlete", back_populates="assessment_results")
    assessment_type = relationship("AssessmentType", back_populates="results")
    recorded_by_user = relationship("AppUser", back_populates="assessment_results")

# -------------------------------
# Injuries
# -------------------------------
class Injury(Base):
    __tablename__ = "injury"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id = Column(UUID(as_uuid=True), ForeignKey("athlete.id"))
    reported_by = Column(UUID(as_uuid=True), ForeignKey("app_user.id"))
    description = Column(Text)
    diagnosis = Column(Text)
    date_reported = Column(Date)
    status = Column(String)  # e.g., open, closed
    restricted = Column(Boolean, default=False)
    metadata = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    athlete = relationship("Athlete", back_populates="injuries")
    reported_by_user = relationship("AppUser", back_populates="injuries_reported")