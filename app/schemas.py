# app/schemas.py

from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime

# -------------------------------
# User Schemas
# -------------------------------

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str
    role_id: str
    institution_id: Optional[str] = None

class UserOut(UserBase):
    id: str
    role_id: str
    institution_id: Optional[str] = None

    class Config:
        orm_mode = True

# -------------------------------
# Athlete Schemas
# -------------------------------

class AthleteBase(BaseModel):
    name: str
    dob: Optional[date] = None
    sport_id: str
    user_id: Optional[str] = None

class AthleteCreate(AthleteBase):
    pass

class AthleteOut(AthleteBase):
    id: str
    institution_id: str

    class Config:
        orm_mode = True

# -------------------------------
# Team Schemas
# -------------------------------

class TeamBase(BaseModel):
    name: str
    sport_id: str
    coach_id: Optional[str] = None

class TeamCreate(TeamBase):
    pass

class TeamOut(TeamBase):
    id: str
    institution_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Session Schemas
# -------------------------------

class SessionBase(BaseModel):
    team_id: str
    coach_id: Optional[str] = None
    title: str
    start_ts: datetime
    end_ts: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None

class SessionCreate(SessionBase):
    pass

class SessionOut(SessionBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Attendance Schemas
# -------------------------------

class AttendanceBase(BaseModel):
    session_id: str
    athlete_id: str
    status: str
    notes: Optional[str] = None

class AttendanceCreate(AttendanceBase):
    pass

class AttendanceOut(AttendanceBase):
    id: str
    recorded_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Assessment Schemas
# -------------------------------

class AssessmentCreate(BaseModel):
    athlete_id: str
    assessment_type_id: str
    value: float
    notes: Optional[str] = None
    recorded_by: Optional[str] = None

class AssessmentOut(AssessmentCreate):
    id: str
    recorded_at: datetime

    class Config:
        orm_mode = True

# -------------------------------
# Injury Schemas
# -------------------------------

class InjuryCreate(BaseModel):
    athlete_id: str
    reported_by: Optional[str] = None
    description: Optional[str] = None
    diagnosis: Optional[str] = None
    date_reported: date
    status: str
    restricted: bool

class InjuryOut(InjuryCreate):
    id: str
    created_at: datetime

    class Config:
        orm_mode = True
