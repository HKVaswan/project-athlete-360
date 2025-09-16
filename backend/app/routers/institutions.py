# app/routers/institutions.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

router = APIRouter(
    prefix="/institutions",
    tags=["Institutions"]
)

# --- Schema (can later move to app/schemas.py if needed) ---
class Institution(BaseModel):
    id: int
    name: str
    location: str

# --- Temporary in-memory storage (replace later with DB) ---
institutions_db = [
    {"id": 1, "name": "National Sports Academy", "location": "Delhi"},
    {"id": 2, "name": "Indian Institute of Sports", "location": "Mumbai"}
]

# --- Endpoints ---
@router.get("/", response_model=List[Institution])
def get_institutions():
    return institutions_db

@router.get("/{institution_id}", response_model=Institution)
def get_institution(institution_id: int):
    for inst in institutions_db:
        if inst["id"] == institution_id:
            return inst
    raise HTTPException(status_code=404, detail="Institution not found")

@router.post("/", response_model=Institution)
def create_institution(institution: Institution):
    institutions_db.append(institution.dict())
    return institution

@router.delete("/{institution_id}")
def delete_institution(institution_id: int):
    for inst in institutions_db:
        if inst["id"] == institution_id:
            institutions_db.remove(inst)
            return {"message": f"Institution {institution_id} deleted successfully"}
    raise HTTPException(status_code=404, detail="Institution not found")
