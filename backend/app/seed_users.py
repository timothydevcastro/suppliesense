# backend/app/seed_users.py

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.user import User as UserModel


def _get_hasher():
    """
    Reuse project's password hashing function if available.
    """
    try:
        from app.core.security import hash_password  # type: ignore
        return hash_password
    except Exception:
        pass

    try:
        from app.core.security import get_password_hash  # type: ignore
        return get_password_hash
    except Exception:
        pass

    # fallback (shouldn't happen if your app uses app.core.security)
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")
    return pwd_context.hash


def _set_password(user: UserModel, hashed: str):
    """
    Different projects name the password column differently.
    We'll try the most common ones.
    """
    for field in ("hashed_password", "password_hash", "password_hashed"):
        if hasattr(user, field):
            setattr(user, field, hashed)
            return

    raise RuntimeError(
        "Could not find a password field on User model. "
        "Expected one of: hashed_password, password_hash, password_hashed. "
        "Open app/models/user.py and check the column name."
    )


def seed_users():
    hasher = _get_hasher()

    seeds = [
        {
            "username": "manager",
            "name": "Manager",
            "role": "manager",
            "password": "manager123",
        },
        {
            "username": "viewer",
            "name": "Viewer",
            "role": "viewer",
            "password": "viewer123",
        },
    ]

    db: Session = SessionLocal()
    try:
        created = 0
        updated = 0

        for s in seeds:
            hashed = hasher(s["password"])

            existing = db.query(UserModel).filter(UserModel.username == s["username"]).first()
            if existing:
                # ✅ FORCE RESET PASSWORD HASH (fixes bcrypt 72-byte issue / algo changes)
                _set_password(existing, hashed)

                # keep role/name in sync too
                if hasattr(existing, "name"):
                    existing.name = s["name"]
                if hasattr(existing, "role"):
                    existing.role = s["role"]
                if hasattr(existing, "is_active"):
                    existing.is_active = True

                updated += 1
                print(f"♻️ Updated: {s['username']} ({getattr(existing, 'role', 'n/a')})")
                continue

            u = UserModel(
                username=s["username"],
                name=s["name"],
                role=s["role"],
            )
            _set_password(u, hashed)

            if hasattr(u, "is_active"):
                setattr(u, "is_active", True)

            db.add(u)
            created += 1
            print(f"✅ Created: {s['username']} ({s['role']})")

        db.commit()

        print(f"\nDone. Created {created} user(s). Updated {updated} user(s).")
        print("\nLogin creds:")
        print(" - manager / manager123")
        print(" - viewer  / viewer123")

    finally:
        db.close()


if __name__ == "__main__":
    seed_users()
