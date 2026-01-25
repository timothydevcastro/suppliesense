# SupplySense

SupplySense is a full-stack inventory management and reorder planning web application designed to help small businesses track stock levels, identify low inventory, and generate smart reorder recommendations based on demand and lead time.

---

## Features

- Secure JWT-based authentication with role-based access (Manager / Viewer)
- Product inventory management (create, edit, soft delete)
- Real-time stock adjustments with undo support
- Smart reorder point (ROP) calculation using:
  - Lead time
  - Average daily demand
  - Safety stock
- Automated reorder list with suggested quantities
- Audit logs for all inventory changes
- CSV export for reorder lists
- Responsive, modern dashboard UI

---

## Tech Stack

### Frontend
- Next.js (App Router)
- React + TypeScript
- Tailwind CSS
- Client-side JWT handling (localStorage)
- Fetch API with auth wrapper

### Backend
- FastAPI (Python)
- SQLAlchemy ORM
- PostgreSQL
- JWT authentication (OAuth2 Bearer)
- Pydantic schemas
- Passlib (pbkdf2_sha256)

---

## Authentication & Roles

- **Manager**
  - Full CRUD access to products
  - Can adjust stock levels
  - Can view audit logs
- **Viewer**
  - Read-only access to products and reorder lists

JWT tokens are required for all protected API routes and are validated server-side.

---

## Reorder Logic

Reorder Point (ROP) is calculated as:

# SupplySense

SupplySense is a full-stack inventory management and reorder planning web application designed to help small businesses track stock levels, identify low inventory, and generate smart reorder recommendations based on demand and lead time.

---

## Features

- Secure JWT-based authentication with role-based access (Manager / Viewer)
- Product inventory management (create, edit, soft delete)
- Real-time stock adjustments with undo support
- Smart reorder point (ROP) calculation using:
  - Lead time
  - Average daily demand
  - Safety stock
- Automated reorder list with suggested quantities
- Audit logs for all inventory changes
- CSV export for reorder lists
- Responsive, modern dashboard UI

---

## Tech Stack

### Frontend
- Next.js (App Router)
- React + TypeScript
- Tailwind CSS
- Client-side JWT handling (localStorage)
- Fetch API with auth wrapper

### Backend
- FastAPI (Python)
- SQLAlchemy ORM
- PostgreSQL
- JWT authentication (OAuth2 Bearer)
- Pydantic schemas
- Passlib (pbkdf2_sha256)

---

## Authentication & Roles

- **Manager**
  - Full CRUD access to products
  - Can adjust stock levels
  - Can view audit logs
- **Viewer**
  - Read-only access to products and reorder lists

JWT tokens are required for all protected API routes and are validated server-side.

---

## Reorder Logic

Reorder Point (ROP) is calculated as:

ROP = (Average Daily Demand × Lead Time Days) + Safety Stock


Products at or below ROP are flagged as **LOW** or **OUT** and appear in the reorder list with suggested reorder quantities.

---

## Demo Accounts

Manager:
username: manager
password: manager123

Viewer:
username: viewer
password: viewer123



---

## Project Structure

frontend/ → Next.js client
backend/ → FastAPI API
README.md → Project documentation


---

## Status

This project was built as a portfolio-quality full-stack application demonstrating real-world authentication, authorization, and inventory management workflows.

---

## Author

Built by [Timothy Rhine L. De Castro]
