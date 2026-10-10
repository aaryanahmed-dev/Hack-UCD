import uuid

from sqlalchemy import DateTime, String, create_engine
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import DATABASE_URL

# pool_pre_ping/pool_recycle avoid "MySQL server has gone away" on idle connections
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# Column types shared by all models
UUIDStr = String(36)
UTCDateTimeCol = DateTime().with_variant(mysql.DATETIME(fsp=6), "mysql")  # naive UTC


def new_id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
