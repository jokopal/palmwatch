from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool

from .config import settings
from .logging import get_logger

log = get_logger("database")

Base = declarative_base()

_engine: create_engine | None = None
_SessionLocal: sessionmaker | None = None


def get_engine():
    """Get or create the SQLAlchemy engine."""
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.db_url,
            poolclass=QueuePool,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=3600,
            connect_args={"connect_timeout": 5},
        )
        log.info("database_engine_created", url=settings.db_url.replace(settings.POSTGIS_PASSWORD, "****"))
    return _engine


def get_session():
    """Get a new SQLAlchemy session."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())
    return _SessionLocal()


def check_connection() -> bool:
    """Check if the database is reachable."""
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        log.warning("database_unreachable", error=str(e))
        return False


def dispose_engine():
    """Dispose the engine (useful in tests)."""
    global _engine, _SessionLocal
    if _engine:
        _engine.dispose()
        _engine = None
        _SessionLocal = None
