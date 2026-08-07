"""
api/sample_data.py
==================
Generator data sample deterministik untuk dashboard PalmWatch.

Dipakai saat PostGIS belum tersedia (mode demo / Fase 1 prototype). Struktur
output mengikuti skema GeoJSON per blok yang didefinisikan di `context.md`:
block_id, area_ha, conditions[], ndvi_value, interventions[], yield_baseline,
yield_predicted_after_intervention, regression_r2, dst.

Semua nilai dihasilkan dengan seed tetap agar reproducible antar request.
"""

from __future__ import annotations

import math
import random
from datetime import date
from typing import Dict, List

# Titik acuan pilot (Kalimantan Timur, sama dengan blocks_example.geojson)
ORIGIN_LON = 117.120
ORIGIN_LAT = -0.555
CELL = 0.015  # ~1.6 km per sisi blok
GRID_COLS = 4
GRID_ROWS = 3

ESTATE = "Kalimantan Timur Estate A"

# Matriks intervensi ringkas (selaras processors/overlay.py)
INTERVENTION_LIBRARY = {
    "irrigation_supplement": {
        "label": "Irigasi suplemen / mulching",
        "lag_weeks_min": 4, "lag_weeks_max": 8,
        "literature": "Corley & Tinker, 2003",
    },
    "fertilization_n": {
        "label": "Pupuk N top-dress (Urea/ZA)",
        "lag_weeks_min": 12, "lag_weeks_max": 24,
        "literature": "Goh et al., 1999",
    },
    "liming": {
        "label": "Pengapuran dolomit",
        "lag_weeks_min": 12, "lag_weeks_max": 16,
        "literature": "Fairhurst & Hardter, 2003",
    },
    "drainage_improvement": {
        "label": "Perbaikan sistem drainase",
        "lag_weeks_min": 4, "lag_weeks_max": 12,
        "literature": "Paramananthan, 2000",
    },
    "pruning_assessment": {
        "label": "Pruning + penjarangan",
        "lag_weeks_min": 8, "lag_weeks_max": 12,
        "literature": "Breure, 2003",
    },
}


def _square(lon: float, lat: float, size: float) -> List[List[float]]:
    return [
        [round(lon, 6), round(lat, 6)],
        [round(lon + size, 6), round(lat, 6)],
        [round(lon + size, 6), round(lat + size, 6)],
        [round(lon, 6), round(lat + size, 6)],
        [round(lon, 6), round(lat, 6)],
    ]


def _priority_from_severity(score: float) -> str:
    if score >= 5:
        return "critical"
    if score >= 2:
        return "warning"
    if score > 0:
        return "monitor"
    return "normal"


def _build_block(idx: int, col: int, row: int) -> Dict:
    """Bangun satu blok deterministik berikut kondisi & intervensi."""
    rng = random.Random(1000 + idx)
    block_id = f"BLK-{idx + 1:03d}"
    lon = ORIGIN_LON + col * CELL
    lat = ORIGIN_LAT + row * CELL
    area_ha = round(rng.uniform(28, 55), 1)
    planting_year = rng.choice([2008, 2010, 2012, 2015, 2018])
    age = 2026 - planting_year

    # Arketipe blok → distribusi kondisi realistis untuk demo peta.
    # Pola tetap (deterministik per posisi grid) memberi spektrum hijau→merah.
    archetype = ["healthy", "healthy", "monitor", "warning", "critical"][idx % 5]

    if archetype == "healthy":
        ndvi = round(rng.uniform(0.60, 0.82), 3)
        rain_30d = round(rng.uniform(170, 300), 1)
        soil_ph = round(rng.uniform(4.8, 5.6), 2)
        soil_soc = round(rng.uniform(12, 22), 1)
        lai = round(rng.uniform(3.5, 5.2), 2)
        lst = round(rng.uniform(28, 33), 1)
    elif archetype == "monitor":
        ndvi = round(rng.uniform(0.50, 0.58), 3)
        rain_30d = round(rng.uniform(150, 200), 1)
        soil_ph = round(rng.uniform(4.6, 5.0), 2)
        soil_soc = round(rng.uniform(9, 14), 1)
        lai = round(rng.uniform(3.0, 4.0), 2)
        lst = round(rng.uniform(31, 35), 1)
    elif archetype == "warning":
        ndvi = round(rng.uniform(0.42, 0.50), 3)
        rain_30d = round(rng.uniform(110, 160), 1)
        soil_ph = round(rng.uniform(4.2, 4.6), 2)
        soil_soc = round(rng.uniform(6, 11), 1)
        lai = round(rng.uniform(2.5, 3.2), 2)
        lst = round(rng.uniform(34, 37), 1)
    else:  # critical
        ndvi = round(rng.uniform(0.30, 0.42), 3)
        rain_30d = round(rng.uniform(45, 100), 1)
        soil_ph = round(rng.uniform(3.9, 4.4), 2)
        soil_soc = round(rng.uniform(3.5, 8), 1)
        lai = round(rng.uniform(1.8, 2.6), 2)
        lst = round(rng.uniform(36, 39), 1)

    evi = round(ndvi * rng.uniform(0.45, 0.6), 3)
    rain_90d = round(rain_30d * rng.uniform(2.4, 3.2), 1)

    # Tag kondisi (ambang selaras processors/overlay.py)
    conditions: List[str] = []
    severity = 0.0

    def add(cond: str, weight: float):
        nonlocal severity
        conditions.append(cond)
        severity += weight

    if ndvi < 0.35:
        add("ndvi_critical", 3)
    elif ndvi < 0.45:
        add("ndvi_low", 2)
    elif ndvi < 0.55:
        add("ndvi_suboptimal", 0.5)
    if evi < 0.30:
        add("evi_low", 2)
    if lai < 2.0:
        add("lai_critical", 3)
    elif lai < 3.0:
        add("lai_low", 2)
    if lst > 38:
        add("heat_critical", 3)
    elif lst > 35:
        add("heat_stress", 2)
    if rain_30d < 100:
        add("rainfall_deficit_30d", 3)
    elif rain_30d < 150:
        add("rainfall_low_30d", 2)
    if soil_ph < 4.0:
        add("soil_ph_critical", 3)
    elif soil_ph < 4.5:
        add("soil_ph_low", 2)
    if soil_soc < 5.0:
        add("soil_soc_critical", 3)
    elif soil_soc < 10.0:
        add("soil_soc_low", 1)

    cond_set = set(conditions)

    # Lookup intervensi (subset rules overlay.py)
    interventions: List[Dict] = []

    def push(key: str, priority: int, effort: float):
        meta = INTERVENTION_LIBRARY[key]
        interventions.append({
            "type": key,
            "label": meta["label"],
            "priority": priority,
            "lag_weeks_min": meta["lag_weeks_min"],
            "lag_weeks_max": meta["lag_weeks_max"],
            "effort_score": round(effort, 2),
            "literature": meta["literature"],
        })

    if {"ndvi_low", "rainfall_deficit_30d"} & cond_set and (
        "rainfall_deficit_30d" in cond_set or "rainfall_low_30d" in cond_set
    ) and any(c.startswith("ndvi") for c in cond_set):
        push("irrigation_supplement", 1, rng.uniform(0.55, 0.85))
    if "soil_soc_low" in cond_set or "soil_soc_critical" in cond_set:
        push("fertilization_n", 2, rng.uniform(0.4, 0.7))
    if "soil_ph_low" in cond_set or "soil_ph_critical" in cond_set:
        push("liming", 2, rng.uniform(0.45, 0.75))
    if "lai_critical" in cond_set or "lai_low" in cond_set:
        push("pruning_assessment", 3, rng.uniform(0.3, 0.6))
    if "heat_stress" in cond_set and rain_30d > 250:
        push("drainage_improvement", 2, rng.uniform(0.4, 0.65))
    interventions.sort(key=lambda x: x["priority"])

    priority = _priority_from_severity(severity)

    # Yield baseline & prediksi (effort-weighted uplift, dibatasi literatur +15%)
    yield_baseline = round(rng.uniform(14, 26), 1)
    total_effort = sum(i["effort_score"] for i in interventions)
    uplift_pct = min(0.15, 0.04 * total_effort)
    yield_predicted = round(yield_baseline * (1 + uplift_pct), 1)
    regression_r2 = round(rng.uniform(0.42, 0.74), 2)

    composite_score = round(min(100.0, severity * 12 + rng.uniform(0, 8)), 1)

    return {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [_square(lon, lat, CELL)],
        },
        "properties": {
            "block_id": block_id,
            "estate": ESTATE,
            "area_ha": area_ha,
            "planting_year": planting_year,
            "age_years": age,
            "variety": "Tenera",
            "last_updated": date(2026, 6, 1).isoformat(),
            "ndvi_value": ndvi,
            "evi_value": evi,
            "lai_value": lai,
            "lst_celsius": lst,
            "rainfall_30d_mm": rain_30d,
            "rainfall_90d_mm": rain_90d,
            "soil_ph": soil_ph,
            "soil_soc": soil_soc,
            "conditions": conditions,
            "n_conditions": len(conditions),
            "severity_score": round(severity, 1),
            "priority_level": priority,
            "interventions": interventions,
            "n_interventions": len(interventions),
            "yield_baseline_ton_ha": yield_baseline,
            "yield_predicted_after_intervention": yield_predicted,
            "regression_r2": regression_r2,
            "composite_score": composite_score,
        },
    }


def build_feature_collection() -> Dict:
    """FeatureCollection semua blok dengan kondisi & intervensi."""
    features = []
    idx = 0
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            features.append(_build_block(idx, col, row))
            idx += 1
    # Ranking intervensi global berdasar composite_score
    ranked = sorted(features, key=lambda f: -f["properties"]["composite_score"])
    for rank, feat in enumerate(ranked, start=1):
        feat["properties"]["intervention_rank"] = rank
    return {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }


def build_timeseries(block_id: str, n_periods: int = 24) -> Dict:
    """
    Time-series bulanan NDVI / curah hujan / EVI vs produksi TBS untuk satu blok.
    Riwayat 24 periode = 2 tahun (ideal untuk regresi, lihat context.md).
    """
    seed = sum(ord(c) for c in block_id)
    rng = random.Random(seed)
    start = date(2024, 6, 1)
    base_ndvi = rng.uniform(0.45, 0.72)
    base_tbs = rng.uniform(1.4, 2.4)  # ton/ha per bulan
    points = []
    for i in range(n_periods):
        # offset i bulan
        month = (start.month - 1 + i) % 12
        year = start.year + (start.month - 1 + i) // 12
        d = date(year, month + 1, 1)
        # musiman: NDVI naik di musim hujan
        seasonal = 0.06 * math.sin((i / 12) * 2 * math.pi)
        ndvi = round(max(0.2, min(0.85, base_ndvi + seasonal + rng.uniform(-0.04, 0.04))), 3)
        evi = round(ndvi * rng.uniform(0.48, 0.58), 3)
        rain = round(max(20, 180 + 120 * math.sin((i / 12) * 2 * math.pi) + rng.uniform(-40, 40)), 1)
        # TBS berkorelasi dengan NDVI + lag 2 bulan curah hujan
        tbs = round(max(0.6, base_tbs * (ndvi / base_ndvi) + rng.uniform(-0.25, 0.25)), 2)
        points.append({
            "date": d.isoformat(),
            "ndvi": ndvi,
            "evi": evi,
            "rainfall_30d_mm": rain,
            "tbs_ton_ha": tbs,
        })
    return {"block_id": block_id, "series": points}


def build_summary(fc: Dict) -> Dict:
    """KPI ringkas untuk header dashboard."""
    feats = fc["features"]
    by_priority = {"critical": 0, "warning": 0, "monitor": 0, "normal": 0}
    total_area = 0.0
    r2_values = []
    for f in feats:
        p = f["properties"]
        by_priority[p["priority_level"]] = by_priority.get(p["priority_level"], 0) + 1
        total_area += p["area_ha"]
        r2_values.append(p["regression_r2"])
    return {
        "tenant_id": "demo",
        "n_blocks": len(feats),
        "total_area_ha": round(total_area, 1),
        "by_priority": by_priority,
        "n_need_intervention": sum(1 for f in feats if f["properties"]["n_interventions"] > 0),
        "mean_regression_r2": round(sum(r2_values) / len(r2_values), 2) if r2_values else 0,
        "last_updated": date(2026, 6, 1).isoformat(),
    }
