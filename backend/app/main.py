import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.errors import UnhandledErrorMiddleware, register_error_handlers
from app.frontend import mount_frontend
from app.routers import groups, health, me, users, ws

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Study Stakes API")

# Order matters: middleware added later wraps earlier ones, so CORS must come after this.
app.add_middleware(UnhandledErrorMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health.router)
app.include_router(me.router)
app.include_router(users.router)
app.include_router(groups.router)
app.include_router(ws.router)

# Must be last: catch-all that serves the web app for every non-API path.
mount_frontend(app)
