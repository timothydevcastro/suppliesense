from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    CheckConstraint,
    Index,
)
from datetime import datetime
from app.core.database import Base


class Product(Base):
    __tablename__ = "products"

    __table_args__ = (
        # SAFETY CONSTRAINTS
        CheckConstraint("quantity >= 0", name="ck_quantity_non_negative"),
        CheckConstraint("lead_time_days >= 0", name="ck_lead_time_non_negative"),
        CheckConstraint("avg_daily_demand >= 0", name="ck_demand_non_negative"),
        CheckConstraint("safety_stock >= 0", name="ck_safety_stock_non_negative"),

        # PERFORMANCE INDEXES
        Index("ix_products_sku", "sku"),
        Index("ix_products_supplier", "supplier"),
    )

    id = Column(Integer, primary_key=True, index=True)

    sku = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    supplier = Column(String, nullable=True)

    quantity = Column(Integer, default=0)

    # legacy (still supported)
    low_stock_threshold = Column(Integer, default=10)

    lead_time_days = Column(Integer, default=0)
    avg_daily_demand = Column(Integer, default=0)
    safety_stock = Column(Integer, default=0)

    # soft delete
    is_active = Column(Boolean, default=True)

    # timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
