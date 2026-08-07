"""
Tes overlay engine keyless (run_overlay.py).

Fokus pada transformasi murni: agregasi lintas source, carry-forward variabel
lambat, tagging kondisi + intervensi, dan gate regresi. Tanpa database.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from run_overlay import (
    aggregate_periods,
    build_feature_frame,
    carry_forward_slow_vars,
    estimate_yield,
    regression_gate,
    run_overlay_frame,
)


def _eo_row(block_id, obs_date, source, **values):
    """Baris eo_readings dengan kolom lengkap (sisanya None), seperti dari DB."""
    from run_overlay import EO_COLUMNS

    row = {"block_id": block_id, "obs_date": obs_date, **{c: None for c in EO_COLUMNS}}
    row.update(values)
    row["source"] = source
    return row


@pytest.fixture
def eo_multi_source() -> pd.DataFrame:
    """Satu blok, Januari 2024: hujan dari open-meteo + NDVI dari Sentinel-2."""
    return pd.DataFrame([
        _eo_row("BLK-001", dt.date(2024, 1, 1), "open-meteo",
                rainfall_30d_mm=80.0, rainfall_90d_mm=260.0, temp_2m_mean=27.5),
        _eo_row("BLK-001", dt.date(2024, 1, 18), "sentinel-2-stac", ndvi_mean=0.38),
    ]).drop(columns=["source"])


# ── Agregasi lintas source (temuan c) ────────────────────────────────────────

def test_agregasi_menyatukan_source_berbeda_dalam_satu_periode(eo_multi_source):
    agg = aggregate_periods(eo_multi_source)

    assert len(agg) == 1, "dua source di bulan sama harus jadi satu baris periode"
    row = agg.iloc[0]
    # Baris NDVI lebih baru, tapi hujan TIDAK boleh hilang — dan sebaliknya.
    assert row["ndvi_mean"] == pytest.approx(0.38)
    assert row["rainfall_30d_mm"] == pytest.approx(80.0)
    assert row["period_start"] == pd.Timestamp("2024-01-01")


def test_agregasi_merata_ratakan_nilai_ganda():
    eo = pd.DataFrame([
        _eo_row("BLK-001", dt.date(2024, 3, 5), "a", ndvi_mean=0.40),
        _eo_row("BLK-001", dt.date(2024, 3, 25), "b", ndvi_mean=0.50),
    ]).drop(columns=["source"])

    agg = aggregate_periods(eo)
    assert agg.iloc[0]["ndvi_mean"] == pytest.approx(0.45)


def test_agregasi_frame_kosong_aman():
    assert aggregate_periods(pd.DataFrame()).empty


# ── Carry-forward variabel lambat ────────────────────────────────────────────

def test_ndvi_dibawa_maju_ke_bulan_tanpa_observasi():
    agg = pd.DataFrame({
        "block_id": ["BLK-001"] * 3,
        "period_start": pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"]),
        "ndvi_mean": [0.38, None, None],
        "rainfall_30d_mm": [80.0, 90.0, 100.0],
    })

    out = carry_forward_slow_vars(agg)
    assert out["ndvi_mean"].tolist() == [0.38, 0.38, 0.38]
    # Hujan tetap apa adanya (akumulasi, tak boleh di-carry).
    assert out["rainfall_30d_mm"].tolist() == [80.0, 90.0, 100.0]


def test_carry_forward_tidak_bocor_antar_blok():
    agg = pd.DataFrame({
        "block_id": ["BLK-001", "BLK-002"],
        "period_start": pd.to_datetime(["2024-01-01", "2024-01-01"]),
        "ndvi_mean": [0.38, None],
    })

    out = carry_forward_slow_vars(agg).set_index("block_id")
    assert out.loc["BLK-001", "ndvi_mean"] == pytest.approx(0.38)
    assert pd.isna(out.loc["BLK-002", "ndvi_mean"]), "nilai blok lain tak boleh menular"


# ── Rename ke nama kolom CONDITION_RULES ─────────────────────────────────────

def test_build_feature_frame_merename_dan_menggabung_tanah():
    agg = pd.DataFrame({
        "block_id": ["BLK-001"],
        "period_start": pd.to_datetime(["2024-01-01"]),
        "rainfall_30d_mm": [80.0],
        "rainfall_90d_mm": [260.0],
        "soil_moisture": [0.18],
    })
    soil = pd.DataFrame({"block_id": ["BLK-001"], "soil_ph": [4.2], "soil_soc": [8.0]})

    feats = build_feature_frame(agg, soil)
    for col in ("rain_acc_30d", "rain_acc_90d", "soil_moisture_m3m3", "soil_phh2o"):
        assert col in feats.columns
    assert feats.iloc[0]["soil_phh2o"] == pytest.approx(4.2)


# ── End-to-end: kondisi -> intervensi ────────────────────────────────────────

def _stressed_eo(block_id="BLK-001", months=3) -> pd.DataFrame:
    rows = []
    for m in range(1, months + 1):
        rows.append(_eo_row(block_id, dt.date(2024, m, 1), "open-meteo",
                            rainfall_30d_mm=80.0, rainfall_90d_mm=260.0))
        rows.append(_eo_row(block_id, dt.date(2024, m, 15), "sentinel-2-stac",
                            ndvi_mean=0.38))
    return pd.DataFrame(rows).drop(columns=["source"])


def test_blok_stres_menghasilkan_kondisi_dan_intervensi_irigasi():
    eo = _stressed_eo()
    soil = pd.DataFrame({"block_id": ["BLK-001"], "soil_ph": [4.2], "soil_soc": [8.0]})

    out = run_overlay_frame(eo, soil)

    assert len(out) == 3, "satu baris kondisi per periode"
    row = out.iloc[0]
    conds = set(row["conditions"] if "conditions" in row else row["conditions_list"])
    assert "ndvi_low" in conds
    assert "rainfall_deficit_30d" in conds
    assert "soil_ph_low" in conds

    labels = {iv["intervention"] for iv in row["interventions"]}
    assert "irrigation_supplement" in labels, "NDVI rendah + hujan defisit -> irigasi"
    assert "liming" in labels, "pH < 4.5 -> pengapuran"
    assert row["priority_level"] in {"monitor", "warning", "critical"}
    assert row["n_interventions"] == len(row["interventions"])


def test_blok_sehat_tidak_dapat_intervensi():
    eo = pd.DataFrame([
        _eo_row("BLK-002", dt.date(2024, 1, 1), "open-meteo",
                rainfall_30d_mm=200.0, rainfall_90d_mm=600.0),
        _eo_row("BLK-002", dt.date(2024, 1, 15), "sentinel-2-stac", ndvi_mean=0.78),
    ]).drop(columns=["source"])
    soil = pd.DataFrame({"block_id": ["BLK-002"], "soil_ph": [5.0], "soil_soc": [20.0]})

    out = run_overlay_frame(eo, soil)
    row = out.iloc[0]
    assert row["n_interventions"] == 0
    assert row["priority_level"] == "normal"


def test_output_siap_tulis_ke_db():
    """Tipe kolom harus cocok dengan skema block_conditions."""
    out = run_overlay_frame(_stressed_eo(), pd.DataFrame())

    assert isinstance(out.iloc[0]["period_start"], dt.date)
    assert isinstance(out.iloc[0]["period_end"], dt.date)
    assert isinstance(out.iloc[0]["priority_level"], str), "Categorical harus jadi text"
    assert out.iloc[0]["period_end"] > out.iloc[0]["period_start"]
    assert "composite_score" in out.columns
    assert "intervention_rank" in out.columns


# ── Gate regresi (jangan mengarang angka) ────────────────────────────────────

def test_regresi_dilewati_bila_periode_kurang_dari_12():
    series = pd.DataFrame({
        "ndvi_mean": [0.4] * 6,
        "tbs_ton_ha": [18.0] * 6,
    })

    reg = regression_gate(series)
    assert reg["regression_r2"] is None
    assert reg["passes_gate"] is False


def test_regresi_tanpa_kolom_tbs_aman():
    reg = regression_gate(pd.DataFrame({"ndvi_mean": [0.4] * 20}))
    assert reg["regression_r2"] is None


def test_regresi_lolos_gate_pada_hubungan_kuat():
    ndvi = [0.30 + i * 0.02 for i in range(14)]
    series = pd.DataFrame({
        "ndvi_mean": ndvi,
        "tbs_ton_ha": [10 + n * 20 for n in ndvi],  # hubungan linear kuat
    })

    reg = regression_gate(series)
    assert reg["passes_gate"] is True
    assert reg["regression_r2"] >= 0.4
    assert reg["slope"] == pytest.approx(20.0, abs=1e-6)


def test_yield_proyeksi_hanya_saat_gate_lolos():
    rows = pd.DataFrame({"ndvi_mean": [0.45], "tbs_ton_ha": [18.0]})

    ditolak = estimate_yield(rows, {"passes_gate": False, "slope": 20.0})
    assert ditolak["yield_baseline_ton_ha"] == 18.0
    assert ditolak["yield_predicted_after_intervention"] is None, \
        "R2 belum valid -> jangan klaim angka proyeksi"

    lolos = estimate_yield(rows, {"passes_gate": True, "slope": 20.0})
    # gap NDVI = 0.65 - 0.45 = 0.20 -> +4.0 ton/ha
    assert lolos["yield_predicted_after_intervention"] == pytest.approx(22.0)


def test_yield_tanpa_data_tbs_menghasilkan_none():
    out = estimate_yield(pd.DataFrame({"ndvi_mean": [0.45]}), {"passes_gate": True, "slope": 5.0})
    assert out["yield_baseline_ton_ha"] is None
