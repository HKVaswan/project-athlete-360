# app/routers/athletes.py

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

# Create athlete (admin or coach only)
@router.post("", response_model=schemas.AthleteOut)
def create_athlete(payload: schemas.AthleteCreate,
                   current_user = Depends(auth.require_role(['admin', 'coach'])),
                   db: Session = Depends(get_db)):

    new_athlete = models.Athlete(
        id=str(uuid.uuid4()),
        first_name=payload.first_name,
        last_name=payload.last_name,
        dob=payload.dob,
        gender=payload.gender,
        primary_sport_id=payload.primary_sport_id,
        user_id=payload.user_id,
        institution_id=current_user.institution_id
    )
    db.add(new_athlete)
    db.commit()
    db.refresh(new_athlete)
    return new_athlete

# List athletes (any user in institution)
@router.get("", response_model=List[schemas.AthleteOut])
def list_athletes(current_user = Depends(auth.get_current_user),
                  db: Session = Depends(get_db)):
    athletes = db.query(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).all()
    return athletes
                    
