"""Tests untuk utils.geometry.load_blocks."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from utils.geometry import load_blocks

EXAMPLE = Path(__file__).resolve().parents[1] / "blocks_example.geojson"


def test_load_example_blocks():
    gdf = load_blocks(EXAMPLE)
    assert len(gdf) == 3
    assert gdf.crs.to_epsg() == 4326
    assert {"block_id", "area_ha", "geometry"} <= set(gdf.columns)
    # block_id dinormalisasi ke string
    assert all(isinstance(b, str) for b in gdf["block_id"])


def test_area_computed_accurately():
    gdf = load_blocks(EXAMPLE)
    # Kotak ~0.015° x 0.015° dekat khatulistiwa ≈ 1.66 km -> ~277 ha.
    blk1 = gdf.loc[gdf.block_id == "BLK-001", "area_ha"].iloc[0]
    assert 250 < blk1 < 300


def test_passthrough_attributes_preserved():
    gdf = load_blocks(EXAMPLE)
    assert "estate" in gdf.columns
    assert "variety" in gdf.columns


def test_missing_file_raises():
    with pytest.raises(FileNotFoundError):
        load_blocks("nonexistent_blocks_xyz.geojson")


def _write_geojson(path: Path, features: list) -> None:
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


def _square(lon: float, lat: float, d: float = 0.01):
    return {
        "type": "Polygon",
        "coordinates": [[
            [lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat],
        ]],
    }


def test_missing_block_id_raises(tmp_path):
    p = tmp_path / "no_id.geojson"
    _write_geojson(p, [{"type": "Feature", "properties": {"name": "x"}, "geometry": _square(117, -0.5)}])
    with pytest.raises(ValueError, match="block_id"):
        load_blocks(p)


def test_duplicate_block_id_raises(tmp_path):
    p = tmp_path / "dup.geojson"
    feat = lambda bid, lon: {  # noqa: E731
        "type": "Feature", "properties": {"block_id": bid}, "geometry": _square(lon, -0.5),
    }
    _write_geojson(p, [feat("BLK-001", 117.0), feat("BLK-001", 117.1)])
    with pytest.raises(ValueError, match="duplikat"):
        load_blocks(p)


def test_empty_collection_raises(tmp_path):
    p = tmp_path / "empty.geojson"
    _write_geojson(p, [])
    with pytest.raises(ValueError):
        load_blocks(p)
