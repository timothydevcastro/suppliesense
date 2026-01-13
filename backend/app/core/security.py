import os
from datetime import datetime, timedelta
from typing import Any, Optional

from jose import jwt, JWTError
from passlib.context import CryptContext

# ✅ ONLY pbkdf2_sha256 (no bcrypt anywhere)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

SECRET_KEY = os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY") or "dev-secret-change-me"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))


def hash_password(password: str) -> str:
    return pwd_context.hash(password or "")


def verify_password(plain_password: str, hashed_password) -> bool:
    if hashed_password is None:
        return False

    # handle bytes/memoryview from DB
    if isinstance(hashed_password, memoryview):
        hashed_password = hashed_password.tobytes()
    if isinstance(hashed_password, (bytes, bytearray)):
        hashed_password = hashed_password.decode("utf-8", errors="ignore")

    return pwd_context.verify(plain_password or "", str(hashed_password))


def create_access_token(data: dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise ValueError("Invalid token") from e
