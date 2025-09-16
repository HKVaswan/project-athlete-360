# app/routers/teams.py

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

# Create a new team (admin only)
@router.post("", response_model=schemas.TeamOut)
def create_team(payload: schemas.TeamCreate,
                current_user = Depends(auth.require_role(['admin'])),
                db: Session = Depends(get_db)):

    # Verify coach exists and belongs to the same institution
    if payload.coach_id:
        coach = db.query(models.AppUser).join(models.UserRole).filter(
            models.AppUser.id == payload.coach_id,
            models.AppUser.institution_id == current_user.institution_id,
            models.UserRole.code == 'coach'
        ).first()
        if not coach:
            raise HTTPException(status_code=400, detail="Invalid coach_id: Coach not found or not in your institution")

    new_team = models.Team(
        id=str(uuid.uuid4()),
        name=payload.name,
        sport_id=payload.sport_id,
        institution_id=current_user.institution_id,
        coach_id=payload.coach_id
    )

    db.add(new_team)
    db.commit()
    db.refresh(new_team)
    return new_team

# List teams (all users in the institution)
@router.get("", response_model=List[schemas.TeamOut])
def list_teams(current_user = Depends(auth.get_current_user),
               db: Session = Depends(get_db)):

    teams = db.query(models.Team).filter(
        models.Team.institution_id == current_user.institution_id
    ).all()
    return teams

