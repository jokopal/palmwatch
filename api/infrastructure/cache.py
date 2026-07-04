"""
Redis caching layer for PalmWatch API.

Provides decorators and utilities for caching expensive operations
like GEE queries, regression results, and dashboard data.
"""

from __future__ import annotations

import json
import pickle
from functools import wraps
from typing import Any, Callable, Optional

from api.core.config import settings
from api.core.logging import get_logger

log = get_logger("cache")


class CacheClient:
    """Redis cache client with fallback to in-memory cache."""

    _redis = None
    _memory: dict[str, tuple[Any, float]] = {}
    _enabled = True

    @classmethod
    def _get_redis(cls):
        if cls._redis is None and cls._enabled:
            try:
                import redis as redis_module
                cls._redis = redis_module.from_url(
                    settings.REDIS_URL,
                    decode_responses=False,
                    socket_connect_timeout=2,
                    socket_timeout=2,
                )
                cls._redis.ping()
                log.info("cache_redis_connected")
            except Exception:
                cls._redis = False
                log.warning("cache_redis_unavailable_fallback_to_memory")
        return cls._redis if cls._redis else None

    @classmethod
    def get(cls, key: str) -> Optional[Any]:
        redis_client = cls._get_redis()
        if redis_client:
            try:
                data = redis_client.get(key)
                return pickle.loads(data) if data else None
            except Exception:
                return None

        # In-memory fallback
        if key in cls._memory:
            value, expiry = cls._memory[key]
            return value
        return None

    @classmethod
    def set(cls, key: str, value: Any, ttl: int = 300) -> None:
        redis_client = cls._get_redis()
        if redis_client:
            try:
                redis_client.setex(key, ttl, pickle.dumps(value))
                return
            except Exception:
                pass

        # In-memory fallback
        cls._memory[key] = (value, ttl)

    @classmethod
    def invalidate(cls, pattern: str) -> None:
        redis_client = cls._get_redis()
        if redis_client:
            try:
                for key in redis_client.scan_iter(match=pattern):
                    redis_client.delete(key)
                return
            except Exception:
                pass

        # In-memory fallback
        cls._memory = {k: v for k, v in cls._memory.items() if not k.startswith(pattern)}


def cached(ttl: int = 300):
    """Decorator: cache function result in Redis with fallback to in-memory."""

    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            key = f"{func.__module__}:{func.__name__}:{json.dumps(args)}:{json.dumps(kwargs, default=str)}"
            cached_value = CacheClient.get(key)
            if cached_value is not None:
                return cached_value

            result = func(*args, **kwargs)
            CacheClient.set(key, result, ttl=ttl)
            return result

        return wrapper

    return decorator
