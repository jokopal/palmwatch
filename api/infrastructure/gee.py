"""
Google Earth Engine client wrapper for PalmWatch.

Provides cached, resilient access to GEE data collections.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Optional

from api.core.config import settings
from api.core.logging import get_logger

log = get_logger("gee_client")


class GEEClient:
    """Resilient GEE client with caching and fallback."""

    _initialized = False

    @classmethod
    def initialize(cls) -> bool:
        if cls._initialized:
            return True

        try:
            import ee

            sa = settings.GEE_SERVICE_ACCOUNT
            key_file = settings.GEE_KEY_FILE
            project = settings.GEE_PROJECT

            if sa and key_file and os.path.exists(key_file):
                credentials = ee.ServiceAccountCredentials(sa, key_file)
                ee.Initialize(credentials, project=project)
                log.info("gee_initialized_service_account", service_account=sa)
            else:
                ee.Initialize(project=project)
                log.info("gee_initialized_local_credentials")

            cls._initialized = True
            return True
        except ImportError:
            log.warning("gee_not_available", detail="earthengine-api not installed")
            return False
        except Exception as e:
            log.error("gee_initialization_failed", error=str(e))
            return False

    @classmethod
    @lru_cache(maxsize=32)
    def get_collection_info(cls, collection_name: str) -> Optional[dict[str, Any]]:
        """Get cached info about a GEE collection."""
        if not cls.initialize():
            return None
        try:
            import ee
            collection = ee.ImageCollection(collection_name)
            info = collection.limit(1).getInfo()
            return {"size": info.get("size", 0), "type": "ImageCollection"}
        except Exception as e:
            log.error("gee_collection_info_failed", collection=collection_name, error=str(e))
            return None

    @classmethod
    def is_available(cls) -> bool:
        """Check if GEE is initialized and reachable."""
        if not cls.initialize():
            return False
        try:
            import ee
            ee.Number(1).getInfo()
            return True
        except Exception:
            return False
