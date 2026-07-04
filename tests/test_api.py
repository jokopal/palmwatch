from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["data_source"] in ("sample",)


def test_summary():
    resp = client.get("/api/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_blocks"] > 0
    assert "by_priority" in body


def test_blocks():
    resp = client.get("/api/blocks")
    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) > 0


def test_blocks_filter():
    for priority in ("critical", "warning", "monitor", "normal"):
        resp = client.get(f"/api/blocks?priority={priority}")
        assert resp.status_code == 200
        for feat in resp.json()["features"]:
            assert feat["properties"]["priority_level"] == priority


def test_blocks_invalid_filter():
    resp = client.get("/api/blocks?priority=invalid")
    assert resp.status_code == 400


def test_block_detail():
    # Get first block
    blocks = client.get("/api/blocks").json()
    block_id = blocks["features"][0]["properties"]["block_id"]

    resp = client.get(f"/api/blocks/{block_id}")
    assert resp.status_code == 200
    assert resp.json()["properties"]["block_id"] == block_id


def test_block_detail_not_found():
    resp = client.get("/api/blocks/NONEXISTENT")
    assert resp.status_code == 404


def test_block_timeseries():
    blocks = client.get("/api/blocks").json()
    block_id = blocks["features"][0]["properties"]["block_id"]

    resp = client.get(f"/api/blocks/{block_id}/timeseries")
    assert resp.status_code == 200
    body = resp.json()
    assert body["block_id"] == block_id
    assert len(body["series"]) > 0


def test_block_timeseries_not_found():
    resp = client.get("/api/blocks/NONEXISTENT/timeseries")
    assert resp.status_code == 404


def test_root():
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["name"] == "PalmWatch API"
