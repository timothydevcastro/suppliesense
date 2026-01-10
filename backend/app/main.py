# backend/app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.auth_routes import router as auth_router  # ✅ FIXED IMPORT

app = FastAPI(title="SupplySense API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Actor"],
)

# Existing API routes (products, reorder, audit-logs, etc.)
app.include_router(api_router, prefix="/api")

# ✅ Auth routes -> /api/auth/login and /api/auth/me
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])


@app.get("/health")
def health():
    return {"status": "ok"}
