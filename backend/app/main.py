# backend/app/main.py

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.api.auth_routes import router as auth_router

app = FastAPI(title="SupplySense API", version="0.1.0")

# Prefer a comma-separated allowlist in prod (Render), fallback to FRONTEND_URL/local
# Example: CORS_ORIGINS="https://suppliesense-frontend.onrender.com,http://localhost:3000"
cors_env = os.getenv("CORS_ORIGINS", "").strip()
if cors_env:
    ALLOW_ORIGINS = [o.strip() for o in cors_env.split(",") if o.strip()]
else:
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").strip()
    ALLOW_ORIGINS = list({FRONTEND_URL, "http://localhost:3000"})

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Actor"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(api_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
