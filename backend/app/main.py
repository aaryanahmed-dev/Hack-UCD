import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.errors import register_error_handlers
from app.routers import health, me, users

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Study Stakes API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health.router)
app.include_router(me.router)
app.include_router(users.router)


@app.get("/")
def root():
    return {"message": "Study Stakes API"}
