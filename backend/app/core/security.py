# backend/app/core/security.py

import os
from datetime import datetime, timedelta
from typing import Any, Optional

from jose import jwt, JWTError
from passlib.context import CryptContext

# ✅ ONLY pbkdf2_sha256 (no bcrypt anywhere)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ✅ IMPORTANT: use ONE secret everywhere (routes.py + deps_auth.py + auth_routes.py)
# Put this on Render as JWT_SECRET_KEY
SECRET_KEY = (
    os.getenv("JWT_SECRET_KEY")
    or os.getenv("JWT_SECRET")
    or os.getenv("SECRET_KEY")
    or "dev-secret-change-me"
)

# ✅ keep algorithm consistent too
ALGORITHM = os.getenv("JWT_ALGORITHM") or "HS256"

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

    s = str(hashed_password).strip()

    # unwrap strings like:  b'...'
    if (s.startswith("b'") and s.endswith("'")) or (s.startswith('b"') and s.endswith('"')):
        s = s[2:-1]

    # ✅ if it's NOT a passlib hash, don't crash (prevents 500)
    # portfolio-safe fallback: treat as plain text compare
    if not s.startswith("$pbkdf2-sha256$"):
        return (plain_password or "") == s

    return pwd_context.verify(plain_password or "", s)


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
