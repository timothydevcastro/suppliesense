import math
from typing import Literal
from app.models.product import Product

Status = Literal["OK", "WARNING", "CRITICAL"]


def compute_rop(lead_time_days: int, avg_daily_demand: float, safety_stock: int) -> int:
    if lead_time_days < 0 or avg_daily_demand < 0 or safety_stock < 0:
        return 0
    return int(math.ceil((avg_daily_demand * lead_time_days) + safety_stock))


def compute_status(qty: int, rop: int, safety_stock: int) -> Status:
    if qty <= safety_stock:
        return "CRITICAL"
    if qty <= rop:
        return "WARNING"
    return "OK"


def compute_reorder_fields(p: Product) -> dict:
    lead = p.lead_time_days or 0
    demand = float(p.avg_daily_demand or 0.0)
    safety = p.safety_stock or 0
    qty = p.quantity or 0

    rop = compute_rop(lead, demand, safety)
    status = compute_status(qty, rop, safety)

    lead_demand = int(math.ceil(demand * lead))
    target = rop + lead_demand
    suggested = max(0, target - qty)
    below_by = max(0, rop - qty)

    return {
        "reorder_point": rop,
        "status": status,
        "target_stock": target,
        "suggested_reorder": suggested,
        "below_by": below_by,
    }
