# backend/app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import database
from app.db import Base, engine

# Import routers
from app.routers import (
    institutions,
    athletes,
    auth as auth_router,
    teams,
    sessions,
    attendance,
    assessments,
    injuries
)

# ---------------------------
# Create database tables
# ---------------------------
# This will create all tables from models.py if they don't exist
Base.metadata.create_all(bind=engine)

# ---------------------------
# FastAPI app initialization
# ---------------------------
app = FastAPI(
    title="Athlete Management System",
    description="Backend API for managing athletes, teams, sessions, and performance metrics.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# ---------------------------
# CORS setup (allow frontend domains)
# ---------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to frontend domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# ---------------------------
# Include routers
# ---------------------------
routers = [
    institutions.router,
    athletes.router,
    auth_router.router,
    teams.router,
    sessions.router,
    attendance.router,
    assessments.router,
    injuries.router
]

for r in routers:
    app.include_router(r)

# ---------------------------
# Root endpoint
# ---------------------------
@app.get("/", tags=["Root"])
def root():
    return {"message": "Welcome to Athlete Management API"}