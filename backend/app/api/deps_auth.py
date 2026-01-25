# backend/app/api/deps_auth.py

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import decode_token
from app.models.user import User as UserModel

# ✅ This is ONLY used by Swagger UI for the "Authorize" flow.
# It does NOT affect normal Authorization: Bearer <token> parsing.
# Keep it consistent with your auth routes.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


class CurrentUser(BaseModel):
    id: int
    username: str
    name: str
    role: str  # "manager" | "viewer"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # token must be the raw JWT (OAuth2PasswordBearer strips "Bearer ")
    if not token or not isinstance(token, str):
        raise cred_exc

    try:
        payload = decode_token(token)
    except Exception:
        raise cred_exc

    sub = payload.get("sub")
    if not sub:
        raise cred_exc

    # sub should be user id
    try:
        user_id = int(sub)
    except Exception:
        raise cred_exc

    user = db.get(UserModel, user_id)
    if not user:
        raise cred_exc

    return CurrentUser(
        id=user.id,
        username=user.username,
        name=user.name,
        role=user.role,
    )


def require_manager(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role != "manager":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager role required")
    return user
