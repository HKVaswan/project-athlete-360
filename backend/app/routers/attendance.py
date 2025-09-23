# app/routers/attendance.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from enum import Enum

router = APIRouter(
    prefix="/attendance",
    tags=["Attendance"]
)

# --- Role Enum ---
class Role(str, Enum):
    ADMIN = "admin"
    COACH = "coach"
    ATHLETE = "athlete"

# --- Dependency: get DB session ---
def get_db():
    db_session = db.SessionLocal()
    try:
        yield db_session
    finally:
        db_session.close()

# --- Record attendance (admin or coach only) ---
@router.post("", response_model=schemas.AttendanceOut)
def create_attendance(
    payload: schemas.AttendanceCreate,
    current_user=Depends(auth.require_role([Role.ADMIN.value, Role.COACH.value])),
    db: Session = Depends(get_db)
):
    # Verify athlete belongs to same institution
    athlete = db.query(models.Athlete).filter(
        models.Athlete.id == payload.athlete_id,
        models.Athlete.institution_id == current_user.institution_id
    ).first()
    if not athlete:
        raise HTTPException(
            status_code=404,
            detail=f"Athlete {payload.athlete_id} not found in your institution"
        )

    # Verify session belongs to same institution
    session_obj = db.query(models.Session).join(models.Team).filter(
        models.Session.id == payload.session_id,
        models.Team.institution_id == current_user.institution_id
    ).first()
    if not session_obj:
        raise HTTPException(
            status_code=404,
            detail=f"Session {payload.session_id} not found in your institution"
        )

    new_attendance = models.Attendance(
        id=uuid.uuid4(),
        athlete_id=payload.athlete_id,
        session_id=payload.session_id,
        status=payload.status,
        notes=payload.notes
    )

    db.add(new_attendance)
    db.commit()
    db.refresh(new_attendance)
    return new_attendance

# --- List attendance records with pagination ---
@router.get("", response_model=List[schemas.AttendanceOut])
def list_attendance(
    current_user=Depends(auth.get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    attendance_records = db.query(models.Attendance).join(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).offset(offset).limit(limit).all()

    return attendance_records