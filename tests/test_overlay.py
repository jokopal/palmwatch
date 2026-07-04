from __future__ import annotations

import pandas as pd

from overlay import tag_conditions, lookup_interventions, compute_composite_score


def _make_block_df(**overrides) -> pd.DataFrame:
    data = {
        "block_id": "BLK-001",
        "ndvi_mean": 0.65,
        "evi_mean": 0.35,
        "lai_mean": 4.0,
        "lst_celsius": 30.0,
        "rain_acc_30d": 200.0,
        "rain_acc_90d": 600.0,
        "et_stress_ratio": 0.85,
        "soil_moisture_m3m3": 0.30,
        "soil_phh2o": 5.0,
        "soil_soc": 15.0,
        "slope_deg": 5.0,
        "twi_approx": 5.0,
    }
    data.update(overrides)
    return pd.DataFrame([data])


def test_tag_conditions_healthy():
    df = _make_block_df()
    result = tag_conditions(df)
    assert result["n_conditions"].iloc[0] == 0
    assert result["priority_level"].iloc[0] == "normal"


def test_tag_conditions_ndvi_low():
    df = _make_block_df(ndvi_mean=0.40)
    result = tag_conditions(df)
    assert result["n_conditions"].iloc[0] >= 1
    assert "ndvi_low" in result["conditions_list"].iloc[0]


def test_tag_conditions_critical():
    df = _make_block_df(ndvi_mean=0.30, rain_acc_30d=50.0, soil_phh2o=4.0, soil_soc=4.0)
    result = tag_conditions(df)
    assert result["n_conditions"].iloc[0] >= 3
    assert result["priority_level"].iloc[0] == "critical"


def test_tag_conditions_nan():
    df = _make_block_df(ndvi_mean=None, rain_acc_30d=None)
    result = tag_conditions(df)
    assert result["n_conditions"].iloc[0] == 0  # NaN should not trigger


def test_lookup_interventions_empty():
    df = _make_block_df()
    df = tag_conditions(df)
    result = lookup_interventions(df)
    assert result["n_interventions"].iloc[0] == 0
    assert result["interventions"].iloc[0] == []


def test_lookup_interventions_irrigation():
    df = _make_block_df(ndvi_mean=0.40, rain_acc_30d=80.0)
    df = tag_conditions(df)
    result = lookup_interventions(df)
    assert result["n_interventions"].iloc[0] >= 1
    types = [i["intervention"] for i in result["interventions"].iloc[0]]
    assert "irrigation_supplement" in types


def test_lookup_interventions_liming():
    df = _make_block_df(soil_phh2o=4.3)
    df = tag_conditions(df)
    result = lookup_interventions(df)
    assert result["n_interventions"].iloc[0] >= 1
    types = [i["intervention"] for i in result["interventions"].iloc[0]]
    assert "liming" in types


def test_compute_composite_score():
    df = _make_block_df(ndvi_mean=0.40, rain_acc_30d=80.0)
    df = tag_conditions(df)
    df = lookup_interventions(df)

    # Add normalized columns
    df["ndvi_mean_norm"] = 0.3
    df["evi_mean_norm"] = 0.4
    df["lai_mean_norm"] = 0.5
    df["rain_acc_90d_norm"] = 0.3
    df["et_stress_ratio_norm"] = 0.4
    df["soil_moisture_m3m3_norm"] = 0.3
    df["soil_phh2o_norm"] = 0.5
    df["soil_soc_norm"] = 0.4

    result = compute_composite_score(df)
    assert "composite_score" in result.columns
    assert "intervention_rank" in result.columns
    assert 0 <= result["composite_score"].iloc[0] <= 100
