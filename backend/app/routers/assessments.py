# app/routers/assessments.py

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import db, models, schemas, auth
import uuid
from typing import List
from enum import Enum

router = APIRouter(
    prefix="/assessments",
    tags=["Assessments"]
)

# --- Role Enum for clarity ---
class Role(str, Enum):
    ADMIN = "admin"
    COACH = "coach"
    ATHLETE = "athlete"

# --- Dependency: get DB session (centralized if needed) ---
def get_db():
    db_session = db.SessionLocal()
    try:
        yield db_session
    finally:
        db_session.close()

# --- Create assessment (admin or coach only) ---
@router.post("", response_model=schemas.AssessmentOut)
def create_assessment(
    payload: schemas.AssessmentCreate,
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

    # Verify assessment type belongs to same institution
    assessment_type = db.query(models.AssessmentType).filter(
        models.AssessmentType.id == payload.assessment_type_id,
        models.AssessmentType.institution_id == current_user.institution_id
    ).first()
    if not assessment_type:
        raise HTTPException(
            status_code=404,
            detail=f"Assessment type {payload.assessment_type_id} not found in your institution"
        )

    # Validate value if needed (example: numeric)
    if not isinstance(payload.value, (int, float)):
        raise HTTPException(
            status_code=400,
            detail="Assessment value must be a number"
        )

    new_assessment = models.AssessmentResult(
        id=uuid.uuid4(),
        athlete_id=payload.athlete_id,
        assessment_type_id=payload.assessment_type_id,
        value=payload.value,
        notes=payload.notes
    )

    db.add(new_assessment)
    db.commit()
    db.refresh(new_assessment)

    return new_assessment

# --- List assessments with optional pagination ---
@router.get("", response_model=List[schemas.AssessmentOut])
def list_assessments(
    current_user=Depends(auth.get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    assessments = db.query(models.AssessmentResult).join(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).offset(offset).limit(limit).all()

    return assessments