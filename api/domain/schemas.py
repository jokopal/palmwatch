from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel


class InterventionSchema(BaseModel):
    type: str
    label: str
    priority: int
    lag_weeks_min: int
    lag_weeks_max: int
    effort_score: float = 0.0
    literature: str


class BlockPropertiesSchema(BaseModel):
    block_id: str
    estate: str | None = None
    area_ha: float = 0.0
    planting_year: int | None = None
    age_years: int | None = None
    variety: str | None = None
    last_updated: date | None = None
    ndvi_value: float | None = None
    evi_value: float | None = None
    lai_value: float | None = None
    lst_celsius: float | None = None
    rainfall_30d_mm: float | None = None
    rainfall_90d_mm: float | None = None
    soil_ph: float | None = None
    soil_soc: float | None = None
    conditions: list[str] = []
    n_conditions: int = 0
    severity_score: float = 0.0
    priority_level: str = "normal"
    interventions: list[InterventionSchema] = []
    n_interventions: int = 0
    yield_baseline_ton_ha: float | None = None
    yield_predicted_after_intervention: float | None = None
    regression_r2: float | None = None
    composite_score: float = 0.0
    intervention_rank: int | None = None


class FeatureSchema(BaseModel):
    type: str = "Feature"
    geometry: dict[str, Any]
    properties: BlockPropertiesSchema


class FeatureCollectionSchema(BaseModel):
    type: str = "FeatureCollection"
    crs: dict[str, Any] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    features: list[FeatureSchema]


class SummarySchema(BaseModel):
    tenant_id: str = "demo"
    n_blocks: int = 0
    total_area_ha: float = 0.0
    by_priority: dict[str, int] = {"critical": 0, "warning": 0, "monitor": 0, "normal": 0}
    n_need_intervention: int = 0
    mean_regression_r2: float = 0.0
    last_updated: str | None = None
    data_source: str = "sample"


class TimeseriesPointSchema(BaseModel):
    date: str
    ndvi: float | None = None
    evi: float | None = None
    rainfall_30d_mm: float | None = None
    tbs_ton_ha: float | None = None


class TimeseriesSchema(BaseModel):
    block_id: str
    series: list[TimeseriesPointSchema]


class HealthSchema(BaseModel):
    status: str = "ok"
    data_source: str = "sample"
    postgis_configured: bool = False
    postgis_reachable: bool = False
    version: str = "0.1.0"
