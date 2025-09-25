# -------------------------------
# User Schemas
# -------------------------------
class UserBase(BaseModel):
    contact_info: str  # updated from email
    full_name: str     # match AppUser model

class UserCreate(UserBase):
    password: str
    role_id: UUID
    institution_id: Optional[UUID] = None

class UserOut(UserBase):
    id: UUID
    role_id: UUID
    institution_id: Optional[UUID] = None

    class Config:
        orm_mode = True