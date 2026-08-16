from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

# API ini TIDAK LAGI punya data sample. Tanpa PostGIS terkonfigurasi, setiap
# endpoint data menjawab 503 — bukan blok sintetis yang tampak meyakinkan.
#
# Tes di bawah menjalankan skenario itu (PostGIS tak tersedia di CI) dan
# memastikan kegagalannya jujur serta konsisten. Dulu tes ini justru mengunci
# perilaku sebaliknya: memastikan data karangan selalu tersaji.


def test_health_melaporkan_sumber_tak_tersedia():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data_source"] == "unavailable"
    assert body["postgis_reachable"] is False
    assert body["status"] == "degraded"


def test_summary_503_tanpa_postgis():
    resp = client.get("/api/summary")
    assert resp.status_code == 503
    assert "PostGIS" in resp.json()["detail"]


def test_blocks_503_tanpa_postgis():
    resp = client.get("/api/blocks")
    assert resp.status_code == 503


def test_blocks_filter_tak_valid_tetap_400():
    """Validasi argumen harus didahulukan sebelum menyentuh sumber data."""
    resp = client.get("/api/blocks?priority=invalid")
    assert resp.status_code == 400


def test_block_detail_503_tanpa_postgis():
    resp = client.get("/api/blocks/000000-001")
    assert resp.status_code == 503


def test_timeseries_503_tanpa_postgis():
    resp = client.get("/api/blocks/000000-001/timeseries")
    assert resp.status_code == 503


def test_root_tetap_hidup():
    """Endpoint meta tidak bergantung pada data, jadi harus tetap 200."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["name"] == "PalmWatch API"
