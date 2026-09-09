from fastapi import FastAPI

from backend.crud import make_crud_router
from backend.database import init_db
from backend.models import QuickLink

app = FastAPI(title="Life Dashboard API")


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(make_crud_router(QuickLink, "/api/quick-links", "quick-links"))


@app.get("/health")
def health():
    return {"status": "ok"}
