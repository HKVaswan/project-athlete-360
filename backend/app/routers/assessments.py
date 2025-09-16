# app/routers/assessments.py

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

# Create assessment (admin or coach only)
@router.post("", response_model=schemas.AssessmentOut)
def create_assessment(payload: schemas.AssessmentCreate,
                      current_user = Depends(auth.require_role(['admin', 'coach'])),
                      db: Session = Depends(get_db)):

    # Verify athlete belongs to same institution
    athlete = db.query(models.Athlete).filter(models.Athlete.id == payload.athlete_id,
                                              models.Athlete.institution_id == current_user.institution_id).first()
    if not athlete:
        raise HTTPException(status_code=404, detail="Athlete not found in your institution")

    # Verify assessment type belongs to same institution
    assessment_type = db.query(models.AssessmentType).filter(
        models.AssessmentType.id == payload.assessment_type_id,
        models.AssessmentType.institution_id == current_user.institution_id
    ).first()
    if not assessment_type:
        raise HTTPException(status_code=404, detail="Assessment type not found in your institution")

    new_assessment = models.AssessmentResult(
        id=str(uuid.uuid4()),
        athlete_id=payload.athlete_id,
        assessment_type_id=payload.assessment_type_id,
        value=payload.value,
        notes=payload.notes
    )

    db.add(new_assessment)
    db.commit()
    db.refresh(new_assessment)
    return new_assessment

# List assessments (all users in the institution)
@router.get("", response_model=List[schemas.AssessmentOut])
def list_assessments(current_user = Depends(auth.get_current_user),
                     db: Session = Depends(get_db)):

    assessments = db.query(models.AssessmentResult).join(models.Athlete).filter(
        models.Athlete.institution_id == current_user.institution_id
    ).all()
    return assessments
