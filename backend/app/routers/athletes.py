# app/routers/athletes.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from enum import Enum

router = APIRouter(
    prefix="/athletes",
    tags=["Athletes"]
)

# --- Role Enum for clarity ---
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

# --- Create athlete (admin or coach only) ---
@router.post("", response_model=schemas.AthleteOut)
def create_athlete(
    payload: schemas.AthleteCreate,
    current_user=Depends(auth.require_role([Role.ADMIN.value, Role.COACH.value])),
    db: Session = Depends(get_db)
):
    # Optional: validate user_id exists
    user_exists = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user_exists:
        raise HTTPException(status_code=404, detail=f"User {payload.user_id} not found")

    new_athlete = models.Athlete(
        id=uuid.uuid4(),  # store as UUID type if DB supports it
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

# --- List athletes with optional pagination ---
@router.get("", response_model=List[schemas.AthleteOut])
def list_athletes(
    current_user=Depends(auth.get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    athletes = db.query(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).offset(offset).limit(limit).all()
    return athletes