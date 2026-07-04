"""
Regression validation engine for PalmWatch.

Implements the statistical gate documented in context.md:
  - OLS per single variable
  - Gate: R² >= 0.40 AND p-value < 0.05
  - GWR for spatial heterogeneity

Usage:
    result = validate_regression(yield_series, ndvi_series, variable_name="ndvi")
    if result.passes_gate:
        # Intervention can be recommended
        print(f"Slope: {result.slope:.2f} tons/unit NDVI")
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.regression.linear_model import OLS, WLS, WLS
from statsmodels.tools import add_constant
from sklearn.metrics import r2_score

from api.core.logging import get_logger

log = get_logger("regression")

MIN_PERIODS = 12  # Minimum 12 periods for valid regression (1 year)
MIN_R_SQUARED = 0.40
MAX_P_VALUE = 0.05


@dataclass
class RegressionResult:
    variable: str
    r_squared: float
    p_value: float
    slope: Optional[float]
    intercept: Optional[float]
    n_periods: int
    passes_gate: bool
    std_err: Optional[float] = None
    f_statistic: Optional[float] = None

    def __str__(self) -> str:
        status = "PASS" if self.passes_gate else "FAIL"
        return (
            f"[{status}] {self.variable}: R²={self.r_squared:.3f}, "
            f"p={self.p_value:.4f}, slope={self.slope:.2f}, n={self.n_periods}"
        )


class InterventionGate:
    """
    Statistical gate for intervention recommendation.

    Per context.md: R² >= 0.40 AND p-value < 0.05
    """

    def __init__(
        self,
        min_r_squared: float = MIN_R_SQUARED,
        max_p_value: float = MAX_P_VALUE,
        min_periods: int = MIN_PERIODS,
    ):
        self.min_r_squared = min_r_squared
        self.max_p_value = max_p_value
        self.min_periods = min_periods

    def evaluate(self, r_squared: float, p_value: float, n_periods: int) -> bool:
        if n_periods < self.min_periods:
            return False
        if r_squared < self.min_r_squared:
            return False
        if p_value >= self.max_p_value:
            return False
        return True


def validate_regression(
    y: np.ndarray | pd.Series,
    x: np.ndarray | pd.Series,
    variable_name: str = "unknown",
    add_intercept: bool = True,
) -> RegressionResult:
    """
    Perform OLS regression and evaluate against the PalmWatch gate.

    Args:
        y: Dependent variable (e.g., yield TBS in ton/ha)
        x: Independent variable (e.g., NDVI mean values)
        variable_name: Name of the independent variable for reporting
        add_intercept: Whether to include an intercept term

    Returns:
        RegressionResult with validation status
    """
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)

    # Remove NaN pairs
    mask = ~(np.isnan(y) | np.isnan(x))
    y_clean = y[mask]
    x_clean = x[mask]
    n_periods = len(y_clean)

    if n_periods < MIN_PERIODS:
        log.warning(
            "insufficient_data",
            variable=variable_name,
            n=n_periods,
            required=MIN_PERIODS,
        )
        return RegressionResult(
            variable=variable_name,
            r_squared=0.0,
            p_value=1.0,
            slope=None,
            intercept=None,
            n_periods=n_periods,
            passes_gate=False,
        )

    try:
        if add_intercept:
            X = add_constant(x_clean)
            model = OLS(y_clean, X).fit()
            slope = float(model.params[1])
            intercept = float(model.params[0])
        else:
            model = OLS(y_clean, x_clean).fit()
            slope = float(model.params[0])
            intercept = 0.0

        r_squared = float(model.rsquared)
        p_value = float(model.pvalues[1] if add_intercept else model.pvalues[0])

        gate = InterventionGate()
        passes = gate.evaluate(r_squared, p_value, n_periods)

        log.info(
            "regression_complete",
            variable=variable_name,
            r_squared=round(r_squared, 4),
            p_value=round(p_value, 6),
            slope=round(slope, 4),
            n=n_periods,
            passes=passes,
        )

        return RegressionResult(
            variable=variable_name,
            r_squared=round(r_squared, 4),
            p_value=round(p_value, 6),
            slope=round(slope, 4),
            intercept=round(intercept, 4),
            n_periods=n_periods,
            passes_gate=passes,
            std_err=round(float(model.bse[1] if add_intercept else model.bse[0]), 4),
            f_statistic=round(float(model.fvalue), 4) if hasattr(model, 'fvalue') else None,
        )

    except Exception as e:
        log.error("regression_failed", variable=variable_name, error=str(e))
        return RegressionResult(
            variable=variable_name,
            r_squared=0.0,
            p_value=1.0,
            slope=None,
            intercept=None,
            n_periods=n_periods,
            passes_gate=False,
        )


def validate_multiple_variables(
    df: pd.DataFrame,
    y_col: str = "tbs_ton_ha",
    x_cols: list[str] | None = None,
    block_col: str = "block_id",
) -> pd.DataFrame:
    """
    Run regression validation for multiple variables across all blocks.

    Args:
        df: DataFrame with time-series data
        y_col: Column name for dependent variable (yield)
        x_cols: List of independent variable column names
        block_col: Column name for block identifier

    Returns:
        DataFrame with one row per (block, variable) combination
    """
    if x_cols is None:
        x_cols = [
            "ndvi_mean", "evi_mean", "lai_mean", "lst_celsius",
            "rainfall_mm", "rain_acc_30d", "rain_acc_90d",
            "et_stress_ratio", "soil_moisture_m3m3",
        ]

    results = []
    for block_id, group in df.groupby(block_col):
        y = group[y_col].dropna().values
        if len(y) < MIN_PERIODS:
            continue

        for var in x_cols:
            if var not in group.columns:
                continue
            x = group[var].dropna().values
            if len(x) < MIN_PERIODS:
                continue

            result = validate_regression(y, x, variable_name=var)
            results.append({
                block_col: block_id,
                "variable": var,
                "r_squared": result.r_squared,
                "p_value": result.p_value,
                "slope": result.slope,
                "intercept": result.intercept,
                "n_periods": result.n_periods,
                "passes_gate": result.passes_gate,
            })

    return pd.DataFrame(results)


def compute_gwr(
    df: pd.DataFrame,
    y_col: str,
    x_col: str,
    coords_cols: list[str] = ["longitude", "latitude"],
    block_id_col: str = "block_id",
    bandwidth: float | None = None,
) -> pd.DataFrame:
    """
    Compute Geographically Weighted Regression (GWR).

    GWR accounts for spatial heterogeneity — different locations may have
    different relationships between yield and EO variables.

    Args:
        df: DataFrame with one row per block
        y_col: Column name for dependent variable
        x_col: Column name for independent variable
        coords_cols: Column names for coordinates
        block_id_col: Column name for block identifier
        bandwidth: Fixed bandwidth (km). If None, use adaptive.

    Returns:
        DataFrame with GWR coefficients per block
    """
    df_clean = df[[block_id_col, y_col, x_col] + coords_cols].dropna().copy()
    n = len(df_clean)

    if n < 5:
        log.warning("gwr_insufficient_data", n=n)
        return pd.DataFrame()

    coords = df_clean[coords_cols].values
    y = df_clean[y_col].values
    x = df_clean[x_col].values

    if bandwidth is None:
        bandwidth = np.percentile(
            np.sqrt(
                (coords[:, 0, np.newaxis] - coords[:, 0]) ** 2
                + (coords[:, 1, np.newaxis] - coords[:, 1]) ** 2
            ),
            50,
            axis=0,
        ).mean() * 0.5
        bandwidth = max(bandwidth, 0.01)

    results = []
    for i in range(n):
        distances = np.sqrt(
            (coords[i, 0] - coords[:, 0]) ** 2
            + (coords[i, 1] - coords[:, 1]) ** 2
        )
        weights = np.exp(-0.5 * (distances / bandwidth) ** 2)
        weights = weights / weights.sum()

        if weights.sum() < 1e-6:
            continue

        try:
            X = add_constant(x)
            model = WLS(y, X, weights=weights).fit()
            results.append({
                block_id_col: df_clean[block_id_col].iloc[i],
                "gwr_coefficient": float(model.params[1]),
                "gwr_intercept": float(model.params[0]),
                "gwr_r_squared": float(model.rsquared),
                "gwr_p_value": float(model.pvalues[1]),
                "gwr_n_obs": n,
            })
        except Exception as e:
            log.error("gwr_failed", block=df_clean[block_id_col].iloc[i], error=str(e))

    result_df = pd.DataFrame(results)
    log.info("gwr_complete", n_blocks=len(result_df))
    return result_df
