# app/routers/injuries.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from enum import Enum

router = APIRouter(
    prefix="/injuries",
    tags=["Injuries"]
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

# --- Record a new injury (admin or coach only) ---
@router.post("", response_model=schemas.InjuryOut)
def create_injury(
    payload: schemas.InjuryCreate,
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

    new_injury = models.Injury(
        id=uuid.uuid4(),
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

# --- List injuries with pagination ---
@router.get("", response_model=List[schemas.InjuryOut])
def list_injuries(
    current_user=Depends(auth.get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    injuries = db.query(models.Injury).join(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).offset(offset).limit(limit).all()

    return injuries