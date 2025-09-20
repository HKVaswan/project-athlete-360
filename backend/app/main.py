# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(
    title="Athlete Management System",
    description="Backend API for managing athletes, teams, sessions, and performance metrics.",
    version="1.0.0"
)

# CORS setup (allow frontend domains)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # You can restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include routers
app.include_router(institutions.router)
app.include_router(athletes.router)
app.include_router(auth_router.router)
app.include_router(teams.router)
app.include_router(sessions.router)
app.include_router(attendance.router)
app.include_router(assessments.router)
app.include_router(injuries.router)

@app.get("/", tags=["Root"])
def root():
    return {"message": "Welcome to Athlete Management API"}
 
