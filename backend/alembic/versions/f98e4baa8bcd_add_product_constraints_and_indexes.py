"""add product constraints and indexes

Revision ID: f98e4baa8bcd
Revises: 7aa62861e85d
Create Date: 2026-01-08 14:53:02.380824
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f98e4baa8bcd"
down_revision: Union[str, Sequence[str], None] = "7aa62861e85d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite-safe batch migration
    with op.batch_alter_table("products", recreate="always") as batch_op:
        # UNIQUE constraint
        batch_op.create_unique_constraint(
            "uq_products_sku",
            ["sku"],
        )

        # CHECK constraints
        batch_op.create_check_constraint(
            "ck_quantity_non_negative",
            "quantity >= 0",
        )
        batch_op.create_check_constraint(
            "ck_lead_time_non_negative",
            "lead_time_days >= 0",
        )
        batch_op.create_check_constraint(
            "ck_demand_non_negative",
            "avg_daily_demand >= 0",
        )
        batch_op.create_check_constraint(
            "ck_safety_stock_non_negative",
            "safety_stock >= 0",
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("products", recreate="always") as batch_op:
        batch_op.drop_constraint("ck_safety_stock_non_negative", type_="check")
        batch_op.drop_constraint("ck_demand_non_negative", type_="check")
        batch_op.drop_constraint("ck_lead_time_non_negative", type_="check")
        batch_op.drop_constraint("ck_quantity_non_negative", type_="check")

        batch_op.drop_constraint("uq_products_sku", type_="unique")
