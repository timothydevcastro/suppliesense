# backend/app/api/routes.py

from fastapi import APIRouter, HTTPException, Depends, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from typing import List, Optional, Literal
from sqlalchemy.orm import Session
from datetime import datetime
import csv
import io
import os

from jose import JWTError, jwt

from app.core.database import SessionLocal
from app.models.product import Product as ProductModel
from app.models.audit_log import AuditLog as AuditLogModel
from app.models.user import User as UserModel
from app.services.reorder import compute_reorder_fields

router = APIRouter()

# ---------- JWT CONFIG (Step 8: protect routes) ----------

SECRET_KEY = os.getenv("JWT_SECRET_KEY") or os.getenv("SECRET_KEY") or "dev-secret-change-me"
ALGORITHM = os.getenv("JWT_ALGORITHM") or "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

# ---------- DB DEP ----------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------- AUTH DEPS ----------

class CurrentUser(BaseModel):
    id: int
    username: str
    name: str
    role: str  # "manager" | "viewer"


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise cred_exc

    sub = payload.get("sub")
    if not sub:
        raise cred_exc

    # sub can be user id OR username/email depending on how you implemented login
    user = None
    try:
        user_id = int(sub)
        user = db.get(UserModel, user_id)
    except Exception:
        user = db.query(UserModel).filter(UserModel.username == str(sub)).first()

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
        raise HTTPException(status_code=403, detail="Manager role required")
    return user

# ---------- AUDIT HELPERS ----------

def get_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def add_audit_log(
    db: Session,
    *,
    action: str,
    p: ProductModel,
    prev_qty: int,
    new_qty: int,
    actor: str,
    ip: Optional[str],
):
    log = AuditLogModel(
        action=action,
        product_id=p.id,
        sku=p.sku,
        name=p.name,
        prev_quantity=prev_qty,
        new_quantity=new_qty,
        delta=new_qty - prev_qty,
        actor=actor,
        ip=ip,
    )
    db.add(log)

# ---------- SCHEMAS ----------

class Product(BaseModel):
    id: int
    sku: str
    name: str
    category: Optional[str] = None
    quantity: int

    # legacy
    low_stock_threshold: int

    supplier: Optional[str] = None
    lead_time_days: int
    avg_daily_demand: float
    safety_stock: int

    is_active: bool

    # ✅ DB returns datetime; keep datetime to avoid ResponseValidationError
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProductCreate(BaseModel):
    sku: str
    name: str
    category: Optional[str] = None
    quantity: int = 0
    low_stock_threshold: int = 10

    supplier: Optional[str] = None
    lead_time_days: int = 0
    avg_daily_demand: float = 0.0
    safety_stock: int = 0


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    low_stock_threshold: Optional[int] = None

    supplier: Optional[str] = None
    lead_time_days: Optional[int] = None
    avg_daily_demand: Optional[float] = None
    safety_stock: Optional[int] = None


class StockUpdate(BaseModel):
    quantity: int


Status = Literal["OK", "WARNING", "CRITICAL"]


class ReorderItem(BaseModel):
    id: int
    sku: str
    name: str
    category: Optional[str]
    supplier: Optional[str]

    quantity: int
    lead_time_days: int
    avg_daily_demand: float
    safety_stock: int

    reorder_point: int
    status: Status

    target_stock: int
    suggested_reorder: int
    below_by: int


class AuditLogOut(BaseModel):
    id: int
    action: str

    product_id: int
    sku: str
    name: str

    prev_quantity: int
    new_quantity: int
    delta: int

    actor: str
    ip: Optional[str] = None
    created_at: Optional[datetime] = None  # ✅ DB returns datetime

    class Config:
        from_attributes = True

# ---------- ROUTES ----------

@router.get("/ping")
def ping():
    return {"message": "pong"}

# ---------- PRODUCTS (viewer+manager can read) ----------

@router.get("/products", response_model=List[Product])
def list_products(
    db: Session = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    return (
        db.query(ProductModel)
        .filter(ProductModel.is_active == True)
        .all()
    )

# ---------- PRODUCTS (manager only can write) ----------

@router.post("/products", response_model=Product)
def create_product(
    payload: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_manager),
):
    if (
        db.query(ProductModel)
        .filter(ProductModel.sku == payload.sku, ProductModel.is_active == True)
        .first()
    ):
        raise HTTPException(status_code=400, detail="SKU already exists")

    p = ProductModel(
        sku=payload.sku.strip(),
        name=payload.name.strip(),
        category=payload.category,
        quantity=payload.quantity,
        low_stock_threshold=payload.low_stock_threshold,
        supplier=payload.supplier,
        lead_time_days=payload.lead_time_days,
        avg_daily_demand=payload.avg_daily_demand,
        safety_stock=payload.safety_stock,
        is_active=True,
    )

    db.add(p)
    db.commit()
    db.refresh(p)

    # audit: product_create (stock snapshot)
    add_audit_log(
        db,
        action="product_create",
        p=p,
        prev_qty=0,
        new_qty=int(p.quantity or 0),
        actor=user.name or user.username,
        ip=get_ip(request),
    )
    db.commit()

    return p


@router.patch("/products/{product_id}", response_model=Product)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_manager),
):
    p = db.get(ProductModel, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail="Product not found")

    prev_qty = int(p.quantity or 0)

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)

    # audit metadata update (qty snapshot)
    add_audit_log(
        db,
        action="product_update",
        p=p,
        prev_qty=prev_qty,
        new_qty=int(p.quantity or 0),
        actor=user.name or user.username,
        ip=get_ip(request),
    )

    db.commit()
    db.refresh(p)
    return p


@router.patch("/products/{product_id}/stock", response_model=Product)
def update_stock(
    product_id: int,
    payload: StockUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_manager),
):
    p = db.get(ProductModel, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail="Product not found")

    prev_qty = int(p.quantity or 0)
    new_qty = int(payload.quantity)

    p.quantity = new_qty

    add_audit_log(
        db,
        action="stock_update",
        p=p,
        prev_qty=prev_qty,
        new_qty=new_qty,
        actor=user.name or user.username,
        ip=get_ip(request),
    )

    db.commit()
    db.refresh(p)
    return p


@router.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_manager),
):
    p = db.get(ProductModel, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail="Product not found")

    # audit before soft delete
    qty = int(p.quantity or 0)
    add_audit_log(
        db,
        action="product_delete",
        p=p,
        prev_qty=qty,
        new_qty=qty,
        actor=user.name or user.username,
        ip=get_ip(request),
    )

    p.is_active = False
    db.commit()
    return {"ok": True}

# ---------- REORDER (viewer+manager can read) ----------

@router.get("/reorder", response_model=List[ReorderItem])
def reorder_list(
    db: Session = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    items: list[ReorderItem] = []

    products = (
        db.query(ProductModel)
        .filter(ProductModel.is_active == True)
        .all()
    )

    for p in products:
        fields = compute_reorder_fields(p)
        if fields["status"] != "OK":
            items.append(
                ReorderItem(
                    id=p.id,
                    sku=p.sku,
                    name=p.name,
                    category=p.category,
                    supplier=p.supplier,
                    quantity=p.quantity,
                    lead_time_days=p.lead_time_days,
                    avg_daily_demand=p.avg_daily_demand,
                    safety_stock=p.safety_stock,
                    **fields,
                )
            )

    return items


@router.get("/reorder.csv")
def reorder_list_csv(
    db: Session = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    items = reorder_list(db=db)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "sku",
            "name",
            "category",
            "supplier",
            "quantity",
            "lead_time_days",
            "avg_daily_demand",
            "safety_stock",
            "reorder_point",
            "status",
            "target_stock",
            "suggested_reorder",
            "below_by",
        ]
    )

    for r in items:
        w.writerow(
            [
                r.sku,
                r.name,
                r.category or "",
                r.supplier or "",
                r.quantity,
                r.lead_time_days,
                r.avg_daily_demand,
                r.safety_stock,
                r.reorder_point,
                r.status,
                r.target_stock,
                r.suggested_reorder,
                r.below_by,
            ]
        )

    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="reorder_list.csv"'},
    )

# ---------- AUDIT LOG READ (viewer+manager can read) ----------

@router.get("/audit-logs", response_model=List[AuditLogOut])
def list_audit_logs(
    product_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _user: CurrentUser = Depends(get_current_user),
):
    limit = max(1, min(limit, 200))

    q = db.query(AuditLogModel).order_by(AuditLogModel.id.desc())

    if product_id is not None:
        q = q.filter(AuditLogModel.product_id == product_id)

    return q.limit(limit).all()
