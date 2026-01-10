from sqlalchemy.orm import Session
from app.core.security import hash_password
from app.models.user import User


def seed_users_if_empty(db: Session):
    existing = db.query(User).count()
    if existing > 0:
        return

    # Change these creds anytime (portfolio defaults)
    manager = User(
        username="manager",
        name="Manager",
        role="manager",
        password_hash=hash_password("manager123"),
    )
    viewer = User(
        username="viewer",
        name="Viewer",
        role="viewer",
        password_hash=hash_password("viewer123"),
    )

    db.add_all([manager, viewer])
    db.commit()
