"""
FastAPI server PalmWatch — backend dashboard SIG (Fase 5).

Menyajikan kondisi blok, intervensi, time-series, dan KPI ringkas ke frontend
React. Membaca dari PostGIS bila tersedia, fallback ke data sample.

Menjalankan:
    pip install -r requirements-api.txt
    uvicorn api.main:app --reload --port 8000

Docs interaktif: http://localhost:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from . import data_source
from .core.config import settings
from .core.logging import configure_logging, get_logger
from .domain.schemas import (
    FeatureCollectionSchema,
    HealthSchema,
    SummarySchema,
    TimeseriesSchema,
)
from .infrastructure.regression import (
    validate_regression,
    validate_multiple_variables,
)

configure_logging()
log = get_logger("api")

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — startup/shutdown hooks."""
    log.info("api_starting", environment=settings.ENVIRONMENT, version=settings.APP_VERSION)

    if settings.SENTRY_DSN:
        try:
            import sentry_sdk
            sentry_sdk.init(
                dsn=settings.SENTRY_DSN,
                environment=settings.ENVIRONMENT,
                traces_sample_rate=0.1,
            )
            log.info("sentry_initialized")
        except Exception as e:
            log.warning("sentry_not_available", error=str(e))

    yield

    log.info("api_shutting_down")


app = FastAPI(
    title=settings.APP_NAME,
    description="Precision Intelligence untuk Perkebunan Kelapa Sawit — backend dashboard",
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    contact={
        "name": "PalmWatch Team",
        "url": "https://palmwatch.id",
        "email": "team@palmwatch.id",
    },
    license_info={
        "name": "Proprietary",
    },
)

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handler ──────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_error", path=request.url.path, error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "path": request.url.path},
    )


# ── Meta endpoints ────────────────────────────────────────────────

@app.get("/", tags=["meta"])
def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/api/health", tags=["meta"])
@limiter.limit("30/minute")
def health(request: Request) -> HealthSchema:
    """Status server + sumber data aktif (postgis / sample)."""
    return data_source.health()


# ── Dashboard endpoints ───────────────────────────────────────────

@app.get("/api/summary", tags=["dashboard"])
@limiter.limit("30/minute")
def summary(request: Request) -> SummarySchema:
    """KPI ringkas: jumlah blok per priority, luas total, mean R²."""
    return data_source.get_summary()


@app.get("/api/blocks", tags=["dashboard"])
@limiter.limit("30/minute")
def blocks(
    request: Request,
    priority: str | None = Query(
        None,
        description="Filter priority_level: critical | warning | monitor | normal",
    ),
) -> FeatureCollectionSchema:
    """FeatureCollection GeoJSON semua blok + kondisi + intervensi."""
    valid = {"critical", "warning", "monitor", "normal", None}
    if priority not in valid:
        raise HTTPException(400, f"priority harus salah satu dari {valid - {None}}")
    return data_source.get_blocks(priority)


@app.get("/api/blocks/{block_id}", tags=["dashboard"])
def block_detail(block_id: str):
    """Detail satu blok (Feature GeoJSON)."""
    feat = data_source.get_block(block_id)
    if feat is None:
        raise HTTPException(404, f"Blok {block_id} tidak ditemukan")
    return feat


@app.get("/api/blocks/{block_id}/timeseries", tags=["dashboard"])
def block_timeseries(block_id: str) -> TimeseriesSchema:
    """Time-series bulanan NDVI / curah hujan / EVI vs produksi TBS."""
    ts = data_source.get_timeseries(block_id)
    if ts is None:
        raise HTTPException(404, f"Blok {block_id} tidak ditemukan")
    return ts


# ── Analysis / Regression endpoints ───────────────────────────────

@app.post("/api/regression/validate", tags=["analysis"])
@limiter.limit("10/minute")
def regression_validate(
    request: Request,
    variable: str = Query(..., description="Variable name (e.g., ndvi_mean)"),
    y_values: list[float] = Query(..., description="Yield values (TBS ton/ha)"),
    x_values: list[float] = Query(..., description="Variable values"),
):
    """Validate a single variable regression against the PalmWatch gate."""
    if len(y_values) != len(x_values):
        raise HTTPException(400, "y_values and x_values must have the same length")
    if len(y_values) < 12:
        raise HTTPException(400, "Need at least 12 data points")

    result = validate_regression(y_values, x_values, variable_name=variable)
    return {
        "variable": result.variable,
        "r_squared": result.r_squared,
        "p_value": result.p_value,
        "slope": result.slope,
        "intercept": result.intercept,
        "n_periods": result.n_periods,
        "passes_gate": result.passes_gate,
        "std_err": result.std_err,
    }


@app.get("/api/analysis/intervention-matrix", tags=["analysis"])
def intervention_matrix():
    """Return the intervention matrix with literature references."""
    from overlay import INTERVENTION_MATRIX

    matrix = []
    for conditions, intervention in INTERVENTION_MATRIX.items():
        matrix.append({
            "conditions": list(conditions),
            "intervention": intervention["intervention"],
            "label": intervention["label"],
            "priority": intervention["priority"],
            "lag_weeks_min": intervention["lag_weeks_min"],
            "lag_weeks_max": intervention["lag_weeks_max"],
            "literature": intervention["literature"],
        })
    return sorted(matrix, key=lambda x: x["priority"])
