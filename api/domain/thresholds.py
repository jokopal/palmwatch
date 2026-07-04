"""
Configurable agronomic thresholds for oil palm.

All thresholds are loaded from thresholds.yaml and can be
overridden per tenant/location as specified in context.md.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import yaml

from api.core.logging import get_logger

log = get_logger("thresholds")

DEFAULT_THRESHOLD_PATH = Path(__file__).parents[2] / "thresholds.yaml"


class ThresholdManager:
    """Manages agronomic thresholds with per-tenant override support."""

    _instance: Optional["ThresholdManager"] = None
    _thresholds: dict[str, Any] = {}
    _tenant_overrides: dict[str, dict[str, Any]] = {}

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, threshold_path: str | None = None):
        if not self._thresholds:
            path = Path(threshold_path) if threshold_path else DEFAULT_THRESHOLD_PATH
            if path.exists():
                with open(path) as f:
                    data = yaml.safe_load(f)
                    self._thresholds = data.get("thresholds", {})
                    log.info("thresholds_loaded", path=str(path), n_params=len(self._thresholds))
            else:
                log.warning("thresholds_not_found", path=str(path))

    def get(self, param: str, key: str, default: Any = None) -> Any:
        """Get a threshold value for a parameter."""
        return self._thresholds.get(param, {}).get(key, default)

    def get_condition(self, param: str, value: float) -> str:
        """
        Classify a parameter value into a condition string.

        Returns one of: 'critical', 'stress', 'normal_low', 'optimal', 'excess'
        """
        thresholds = self._thresholds.get(param, {})
        if not thresholds:
            return "unknown"

        if value < thresholds.get("critical_low", -float("inf")):
            return "critical"
        if value < thresholds.get("stress", -float("inf")):
            return "stress"
        if value < thresholds.get("normal_low", -float("inf")):
            return "normal_low"
        if value >= thresholds.get("critical_high", float("inf")):
            return "excess"
        if value >= thresholds.get("stress_high", float("inf")):
            return "stress_high"
        return "optimal"

    def set_tenant_override(self, tenant_id: str, overrides: dict[str, Any]) -> None:
        """Override thresholds for a specific tenant."""
        self._tenant_overrides[tenant_id] = overrides
        log.info("tenant_thresholds_set", tenant=tenant_id, n_overrides=len(overrides))

    def get_tenant_threshold(self, tenant_id: str, param: str, key: str, default: Any = None) -> Any:
        """Get tenant-specific threshold with fallback to global."""
        tenant_overrides = self._tenant_overrides.get(tenant_id, {})
        return tenant_overrides.get(param, {}).get(key, self.get(param, key, default))
