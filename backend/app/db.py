# backend/app/db.py

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in environment variables")

# SQLAlchemy Engine
engine = create_engine(DATABASE_URL, echo=True)

# Session local class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()

# Dependency to get DB session in FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from uuid import UUID

# -------------------------------
# User Schemas
# -------------------------------
class UserBase(BaseModel):
    username: str
    contact_info: str  # updated from 'email'

class UserCreate(UserBase):
    password: str
    role_id: UUID
    institution_id: Optional[UUID] = None

class UserOut(UserBase):
    id: UUID
    role_id: UUID
    institution_id: Optional[UUID] = None

    class Config:
        orm_mode = True

# -------------------------------
# Athlete Schemas
# -------------------------------
class AthleteBase(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    dob: Optional[date] = None
    primary_sport_id: UUID
    user_id: Optional[UUID] = None

class AthleteCreate(AthleteBase):
    pass

class AthleteOut(AthleteBase):
    id: UUID
    institution_id: UUID

    class Config:
        orm_mode = True

# -------------------------------
# Team Schemas
# -------------------------------
class TeamBase(BaseModel):
    name: str
    sport_id: UUID
    coach_id: Optional[UUID] = None

class TeamCreate(TeamBase):
    pass

class TeamOut(TeamBase):
    id: UUID
    institution_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Session Schemas
# -------------------------------
class SessionBase(BaseModel):
    team_id: UUID
    coach_id: Optional[UUID] = None
    title: str
    start_ts: datetime
    end_ts: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None

class SessionCreate(SessionBase):
    pass

class SessionOut(SessionBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Attendance Schemas
# -------------------------------
class AttendanceBase(BaseModel):
    session_id: UUID
    athlete_id: UUID
    status: str
    notes: Optional[str] = None

class AttendanceCreate(AttendanceBase):
    pass

class AttendanceOut(AttendanceBase):
    id: UUID
    recorded_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Assessment Schemas
# -------------------------------
class AssessmentBase(BaseModel):
    athlete_id: UUID
    assessment_type_id: UUID
    value: float
    notes: Optional[str] = None

class AssessmentCreate(AssessmentBase):
    recorded_by: Optional[UUID] = None

class AssessmentOut(AssessmentBase):
    id: UUID
    recorded_at: datetime
    recorded_by: Optional[UUID] = None

    class Config:
        orm_mode = True

# -------------------------------
# Injury Schemas
# -------------------------------
class InjuryBase(BaseModel):
    athlete_id: UUID
    description: Optional[str] = None
    diagnosis: Optional[str] = None
    date_reported: date
    status: str
    restricted: bool

class InjuryCreate(InjuryBase):
    reported_by: Optional[UUID] = None

class InjuryOut(InjuryBase):
    id: UUID
    reported_by: Optional[UUID] = None
    created_at: datetime

    class Config:
        orm_mode = True