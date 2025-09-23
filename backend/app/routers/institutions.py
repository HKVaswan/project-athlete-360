# app/routers/institutions.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from enum import Enum

router = APIRouter(
    prefix="/institutions",
    tags=["Institutions"]
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

# --- List institutions with optional pagination ---
@router.get("/", response_model=List[schemas.InstitutionOut])
def get_institutions(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    institutions = db.query(models.Institution).offset(offset).limit(limit).all()
    return institutions

# --- Get single institution ---
@router.get("/{institution_id}", response_model=schemas.InstitutionOut)
def get_institution(
    institution_id: uuid.UUID,
    db: Session = Depends(get_db)
):
    institution = db.query(models.Institution).filter(models.Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=404, detail="Institution not found")
    return institution

# --- Create institution (admin only) ---
@router.post("/", response_model=schemas.InstitutionOut)
def create_institution(
    institution: schemas.InstitutionCreate,
    current_user=Depends(auth.require_role([Role.ADMIN.value])),
    db: Session = Depends(get_db)
):
    new_institution = models.Institution(
        id=uuid.uuid4(),
        name=institution.name,
        location=institution.location
    )
    db.add(new_institution)
    db.commit()
    db.refresh(new_institution)
    return new_institution

# --- Delete institution (admin only) ---
@router.delete("/{institution_id}")
def delete_institution(
    institution_id: uuid.UUID,
    current_user=Depends(auth.require_role([Role.ADMIN.value])),
    db: Session = Depends(get_db)
):
    institution = db.query(models.Institution).filter(models.Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=404, detail="Institution not found")
    db.delete(institution)
    db.commit()
    return {"message": f"Institution {institution_id} deleted successfully"}