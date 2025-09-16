# app/routers/attendance.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List

router = APIRouter()

# Dependency: get DB session
def get_db():
    dbs = db.SessionLocal()
    try:
        yield dbs
    finally:
        dbs.close()

# Record attendance (admin or coach only)
@router.post("", response_model=schemas.AttendanceOut)
def create_attendance(payload: schemas.AttendanceCreate,
                      current_user = Depends(auth.require_role(['admin', 'coach'])),
                      db: Session = Depends(get_db)):

    # Verify athlete belongs to same institution
    athlete = db.query(models.Athlete).filter(
        models.Athlete.id == payload.athlete_id,
        models.Athlete.institution_id == current_user.institution_id
    ).first()
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found in your institution")

    # Verify session belongs to same institution
    session_obj = db.query(models.Session).join(models.Team).filter(
        models.Session.id == payload.session_id,
        models.Team.institution_id == current_user.institution_id
    ).first()
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session not found in your institution")

    new_attendance = models.Attendance(
        id=str(uuid.uuid4()),
        athlete_id=payload.athlete_id,
        session_id=payload.session_id,
        status=payload.status,
        notes=payload.notes
    )

    db.add(new_attendance)
    db.commit()
    db.refresh(new_attendance)
    return new_attendance

# List attendance records (all users in the institution)
@router.get("", response_model=List[schemas.AttendanceOut])
def list_attendance(current_user = Depends(auth.get_current_user),
                    db: Session = Depends(get_db)):

    attendance_records = db.query(models.Attendance).join(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).all()
    return attendance_records
