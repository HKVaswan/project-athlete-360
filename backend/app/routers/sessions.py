# app/routers/sessions.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from datetime import datetime

router = APIRouter()

# Dependency: get DB session
def get_db():
    dbs = db.SessionLocal()
    try:
        yield dbs
    finally:
        dbs.close()

# Create a new session (admin or coach only)
@router.post("", response_model=schemas.SessionOut)
def create_session(payload: schemas.SessionCreate,
                   current_user = Depends(auth.require_role(['admin', 'coach'])),
                   db: Session = Depends(get_db)):

    # Verify team belongs to same institution
    team = db.query(models.Team).filter(
        models.Team.id == payload.team_id,
        models.Team.institution_id == current_user.institution_id
    ).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found in your institution")

    # Optional: verify coach_id is in same institution and role=coach
    if payload.coach_id:
        coach = db.query(models.AppUser).join(models.UserRole).filter(
            models.AppUser.id == payload.coach_id,
            models.AppUser.institution_id == current_user.institution_id,
            models.UserRole.code == 'coach'
        ).first()
        if not coach:
            raise HTTPException(status_code=400, detail="Invalid coach_id for your institution")

    new_session = models.Session(
        id=str(uuid.uuid4()),
        team_id=payload.team_id,
        coach_id=payload.coach_id,
        title=payload.title,
        start_ts=payload.start_ts,
        end_ts=payload.end_ts,
        location=payload.location,
        notes=payload.notes
    )

    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return new_session

# List sessions (all users in the institution)
@router.get("", response_model=List[schemas.SessionOut])
def list_sessions(current_user = Depends(auth.get_current_user),
                  db: Session = Depends(get_db)):

    sessions = db.query(models.Session).join(models.Team).filter(
        models.Team.institution_id == current_user.institution_id
    ).all()
    return sessions
