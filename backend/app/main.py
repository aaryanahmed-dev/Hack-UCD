import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.errors import UnhandledErrorMiddleware, register_error_handlers
from app.frontend import mount_frontend
from app.routers import commerce, groups, health, me, productivity, sessions, social, users, ws
from app.services import engine
from app.services.realtime import manager

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Background work: pushing realtime updates and advancing session timers / AI jobs.
    tasks = [manager.start(asyncio.get_running_loop()), asyncio.create_task(engine.run_forever())]
    yield
    for task in tasks:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Study Stakes API", lifespan=lifespan)

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
app.include_router(sessions.router)
app.include_router(social.router)
app.include_router(productivity.router)
app.include_router(commerce.router)
app.include_router(ws.router)

# Must be last: catch-all that serves the web app for every non-API path.
mount_frontend(app)
