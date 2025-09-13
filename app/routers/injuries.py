# app/routers/injuries.py

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

# Record a new injury (admin or coach only)
@router.post("", response_model=schemas.InjuryOut)
def create_injury(payload: schemas.InjuryCreate,
                  current_user = Depends(auth.require_role(['admin', 'coach'])),
                  db: Session = Depends(get_db)):

    # Verify athlete belongs to same institution
    athlete = db.query(models.Athlete).filter(models.Athlete.id == payload.athlete_id,
                                              models.Athlete.institution_id == current_user.institution_id).first()
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found in your institution")

    new_injury = models.Injury(
        id=str(uuid.uuid4()),
        athlete_id=payload.athlete_id,
        reported_by=current_user.id,
        description=payload.description,
        diagnosis=payload.diagnosis,
        date_reported=payload.date_reported,
        status=payload.status,
        restricted=payload.restricted
    )

    db.add(new_injury)
    db.commit()
    db.refresh(new_injury)
    return new_injury

# List injuries (all users in the institution)
@router.get("", response_model=List[schemas.InjuryOut])
def list_injuries(current_user = Depends(auth.get_current_user),
                  db: Session = Depends(get_db)):

    injuries = db.query(models.Injury).join(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).all()
    return injuries
