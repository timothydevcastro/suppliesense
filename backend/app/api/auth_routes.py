# backend/app/api/auth_routes.py

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordRequestForm

from app.api.deps_auth import get_db, get_current_user
from app.core.security import verify_password, create_access_token
from app.models.user import User

router = APIRouter()


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    role: str

    class Config:
        from_attributes = True


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ✅ KEEP: JSON login (your curl + Try it out works)
@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    username = payload.username.strip()

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    token = create_access_token({"sub": str(user.id), "role": user.role})

    return LoginOut(
        access_token=token,
        user=UserOut.model_validate(user),
    )


# ✅ ADD: OAuth2 form endpoint (Swagger Authorize uses this)
@router.post("/token", response_model=LoginOut)
def token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username = (form_data.username or "").strip()
    password = form_data.password or ""

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    token = create_access_token({"sub": str(user.id), "role": user.role})

    return LoginOut(
        access_token=token,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)
