# backend/app/db.py

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in environment variables")

# SQLAlchemy Engine
engine = create_engine(DATABASE_URL, echo=True)

# Session local class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()

# Dependency to get DB session in FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()