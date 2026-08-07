from __future__ import annotations

import pandas as pd

from normalizer import minmax_normalize, zscore_normalize, flag_outliers


def test_minmax_normalize():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [10, 20, 30, 40, 50]})
    result, params = minmax_normalize(df, columns=["a", "b"])

    assert "a_norm" in result.columns
    assert "b_norm" in result.columns
    assert result["a_norm"].min() == 0.0
    assert result["a_norm"].max() == 1.0
    assert result["b_norm"].min() == 0.0
    assert result["b_norm"].max() == 1.0
    assert "a" in params
    assert "b" in params


def test_minmax_normalize_constant():
    df = pd.DataFrame({"a": [5, 5, 5, 5]})
    result, params = minmax_normalize(df, columns=["a"])
    assert (result["a_norm"] == 0.0).all()


def test_minmax_normalize_empty():
    df = pd.DataFrame({"a": []})
    result, params = minmax_normalize(df, columns=["a"])
    assert "a_norm" in result.columns


def test_zscore_normalize():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    result, params = zscore_normalize(df, columns=["a"])

    assert "a_z" in result.columns
    assert abs(result["a_z"].mean()) < 1e-10
    assert abs(result["a_z"].std() - 1.0) < 1e-10
    assert "a" in params


def test_zscore_normalize_constant():
    df = pd.DataFrame({"a": [5, 5, 5, 5]})
    result, params = zscore_normalize(df, columns=["a"])
    assert (result["a_z"] == 0.0).all()


def test_zscore_robust():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 100]})
    result_std, params_std = zscore_normalize(df, columns=["a"], robust=False)
    result_rob, params_rob = zscore_normalize(df, columns=["a"], robust=True)
    # Robust center (median) should be closer to the majority of data than mean
    assert abs(params_rob["a"]["center"] - 3) < abs(params_std["a"]["center"] - 3)
    # Robust scale should be MAD-based
    assert params_rob["a"]["method"] == "robust_zscore"


def test_flag_outliers_iqr():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5, 100]})
    result = flag_outliers(df, columns=["a"], method="iqr", threshold=3.0)
    assert result["a_outlier_flag"].iloc[-1]  # 100 should be outlier
    assert not result["a_outlier_flag"].iloc[:-1].any()


def test_flag_outliers_zscore():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5, 100]})
    result = flag_outliers(df, columns=["a"], method="zscore", threshold=2.0)
    assert result["a_outlier_flag"].iloc[-1]
