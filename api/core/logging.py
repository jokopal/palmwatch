from __future__ import annotations

import logging
import structlog
from .config import settings


def configure_logging() -> None:
    """Configure structured logging with structlog."""

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.dev.ConsoleRenderer()
            if settings.ENVIRONMENT == "development"
            else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    root = logging.getLogger()
    root.setLevel(settings.LOG_LEVEL.upper())

    # Quiet noisy libs
    for lib in ("httpx", "urllib3", "botocore", "s3transfer"):
        logging.getLogger(lib).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
