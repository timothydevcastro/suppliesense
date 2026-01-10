from sqlalchemy import Column, DateTime, Integer, String, func
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)

    # what happened
    action = Column(String, nullable=False)  # e.g. "stock_update", "product_create"

    # what item
    product_id = Column(Integer, nullable=False, index=True)
    sku = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)

    # change details
    prev_quantity = Column(Integer, nullable=False, default=0)
    new_quantity = Column(Integer, nullable=False, default=0)
    delta = Column(Integer, nullable=False, default=0)

    # who/where
    actor = Column(String, nullable=False, default="system")
    ip = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
