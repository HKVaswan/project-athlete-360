# app/routers/teams.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from enum import Enum

router = APIRouter(
    prefix="/teams",
    tags=["Teams"]
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

# --- Create a new team (admin only) ---
@router.post("", response_model=schemas.TeamOut)
def create_team(
    payload: schemas.TeamCreate,
    current_user=Depends(auth.require_role([Role.ADMIN.value])),
    db: Session = Depends(get_db)
):
    # Verify coach exists and belongs to the same institution
    if payload.coach_id:
        coach = db.query(models.AppUser).join(models.UserRole).filter(
            models.AppUser.id == payload.coach_id,
            models.AppUser.institution_id == current_user.institution_id,
            models.UserRole.code == Role.COACH.value
        ).first()
        if not coach:
            raise HTTPException(
                status_code=400,
                detail="Invalid coach_id: Coach not found or not in your institution"
            )

    new_team = models.Team(
        id=uuid.uuid4(),
        name=payload.name,
        sport_id=payload.sport_id,
        institution_id=current_user.institution_id,
        coach_id=payload.coach_id
    )

    db.add(new_team)
    db.commit()
    db.refresh(new_team)
    return new_team

# --- List teams with pagination ---
@router.get("", response_model=List[schemas.TeamOut])
def list_teams(
    current_user=Depends(auth.get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    teams = db.query(models.Team).filter(
        models.Team.institution_id == current_user.institution_id
    ).offset(offset).limit(limit).all()

    return teams