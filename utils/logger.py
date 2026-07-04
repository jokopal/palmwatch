"""
Lightweight structured logger for pipeline scripts.

Gunakan:
    from utils.logger import get_logger
    log = get_logger("pipeline")
    log.info("Processing blocks", n_blocks=42)
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


class StructuredFormatter(logging.Formatter):
    """JSON-structured log formatter untuk pipeline scripts."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Field terstruktur disuntikkan oleh StructuredLogger via extra=.
        structured = getattr(record, "structured", None)
        if structured:
            log_entry.update(structured)
        return json.dumps(log_entry, default=str)


class StructuredLogger:
    """
    Pembungkus tipis di atas logging.Logger yang menerima keyword fields dan
    memancarkannya sebagai JSON (mis. ``log.info("blocks_loaded", n=42)``).

    Backward-compatible: pemanggilan gaya pesan biasa (``log.info("teks")``)
    tetap bekerja. Atribut lain didelegasikan ke logger yang dibungkus.
    """

    __slots__ = ("_logger",)

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger

    def _emit(self, level: int, msg: str, **fields: Any) -> None:
        # 'structured' dibaca oleh StructuredFormatter.
        self._logger.log(level, msg, extra={"structured": fields or None})

    def debug(self, msg: str, **f: Any) -> None:
        self._emit(logging.DEBUG, msg, **f)

    def info(self, msg: str, **f: Any) -> None:
        self._emit(logging.INFO, msg, **f)

    def warning(self, msg: str, **f: Any) -> None:
        self._emit(logging.WARNING, msg, **f)

    def error(self, msg: str, **f: Any) -> None:
        self._emit(logging.ERROR, msg, **f)

    def exception(self, msg: str, **f: Any) -> None:
        self._logger.exception(msg, extra={"structured": f or None})

    def __getattr__(self, item: str) -> Any:  # delegasi (setLevel, dll.)
        return getattr(self._logger, item)


def get_logger(name: str, level: str | None = None) -> StructuredLogger:
    """
    Dapatkan logger terstruktur JSON.

    Args:
        name: Nama logger (contoh: 'pipeline', 'normalizer', 'overlay')
        level: Log level ('DEBUG', 'INFO', 'WARNING', 'ERROR').
               Default dari env LOG_LEVEL atau 'INFO'.

    Returns:
        StructuredLogger — mendukung ``log.info("event", key=value)``.
    """
    logger = logging.getLogger(name)

    if logger.handlers:
        return StructuredLogger(logger)

    log_level = (level or "INFO").upper()
    logger.setLevel(getattr(logging, log_level, logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    logger.addHandler(handler)

    logger.propagate = False

    return StructuredLogger(logger)
