from app.core.database import SessionLocal, engine, Base
from app.models.product import Product

# make sure tables exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()

# wipe existing data (DEV ONLY)
db.query(Product).delete()
db.commit()

products = [
    Product(
        sku="SKU-001",
        name="Widget A",
        category="Widgets",
        quantity=12,
        low_stock_threshold=10,
        supplier="ACME",
        lead_time_days=7,
        avg_daily_demand=1.5,
        safety_stock=5,
    ),
    Product(
        sku="SKU-002",
        name="Widget B",
        category="Widgets",
        quantity=6,
        low_stock_threshold=10,
        supplier="ACME",
        lead_time_days=7,
        avg_daily_demand=2.0,
        safety_stock=4,
    ),
    Product(
        sku="SKU-003",
        name="Gadget C",
        category="Gadgets",
        quantity=2,
        low_stock_threshold=8,
        supplier="Globex",
        lead_time_days=14,
        avg_daily_demand=1.2,
        safety_stock=6,
    ),
]

db.add_all(products)
db.commit()
db.close()

print("✅ Database seeded")
