from sqlalchemy import Column, Integer, String
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    username = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)

    # "manager" | "viewer"
    role = Column(String, nullable=False, default="viewer")

    password_hash = Column(String, nullable=False)
