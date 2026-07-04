from __future__ import annotations

import numpy as np
import pandas as pd

from api.infrastructure.regression import (
    validate_regression,
    compute_gwr,
    InterventionGate,
    RegressionResult,
)


def test_validate_regression_passes():
    """When R² >= 0.40 and p < 0.05, the variable passes the gate."""
    rng = np.random.default_rng(42)
    x = np.linspace(0, 10, 50)
    y = 2.0 * x + 1.0 + rng.normal(0, 2, 50)

    result = validate_regression(y, x, variable_name="ndvi")
    assert result.passes_gate
    assert result.r_squared >= 0.40
    assert result.p_value < 0.05
    assert result.variable == "ndvi"
    assert result.slope is not None
    assert result.intercept is not None


def test_validate_regression_fails():
    """Random noise should not pass the gate."""
    rng = np.random.default_rng(42)
    x = np.linspace(0, 10, 50)
    y = rng.normal(0, 1, 50)

    result = validate_regression(y, x, variable_name="noise")
    assert not result.passes_gate
    assert result.r_squared < 0.40 or result.p_value >= 0.05


def test_validate_regression_insufficient_data():
    """Fewer than 12 periods should fail."""
    x = np.array([1, 2, 3])
    y = np.array([1, 2, 3])
    result = validate_regression(y, x, variable_name="short")
    assert not result.passes_gate


def test_regression_result_str():
    result = RegressionResult(
        variable="ndvi",
        r_squared=0.65,
        p_value=0.001,
        slope=8.2,
        intercept=10.0,
        n_periods=24,
        passes_gate=True,
    )
    s = str(result)
    assert "ndvi" in s
    assert "PASS" in s
    assert "8.20" in s


def test_compute_gwr():
    """GWR should return coefficients per location."""
    rng = np.random.default_rng(42)
    n = 30
    df = pd.DataFrame({
        "block_id": [f"BLK-{i:03d}" for i in range(n)],
        "ndvi_mean": rng.uniform(0.3, 0.8, n),
        "tbs_ton_ha": rng.uniform(1.0, 3.0, n),
        "longitude": rng.uniform(117.0, 118.0, n),
        "latitude": rng.uniform(-1.0, 0.0, n),
    })

    result = compute_gwr(
        df=df,
        y_col="tbs_ton_ha",
        x_col="ndvi_mean",
        coords_cols=["longitude", "latitude"],
        block_id_col="block_id",
    )

    assert len(result) > 0
    assert "block_id" in result.columns
    assert "gwr_coefficient" in result.columns
    assert "gwr_r_squared" in result.columns


def test_intervention_gate():
    gate = InterventionGate(min_r_squared=0.40, max_p_value=0.05, min_periods=12)

    # Passes
    assert gate.evaluate(r_squared=0.65, p_value=0.001, n_periods=24)

    # Fails: low R²
    assert not gate.evaluate(r_squared=0.25, p_value=0.001, n_periods=24)

    # Fails: high p-value
    assert not gate.evaluate(r_squared=0.65, p_value=0.10, n_periods=24)

    # Fails: insufficient periods
    assert not gate.evaluate(r_squared=0.65, p_value=0.001, n_periods=6)
