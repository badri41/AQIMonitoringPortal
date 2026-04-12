"""
model.py — Convenience re-export of all ML model functions.

This module provides a single import point for all ML models used
in the AQI monitoring pipeline. Each model is implemented in its
own file under the `models/` package.

Usage:
    from model import forecast_city_aqi, detect_anomalies, cluster_cities, compute_health_risk
"""

# ── LSTM / Holt-Winters Forecaster ────────────────────────────────────
from models.forecaster import forecast_city_aqi

# ── Isolation Forest Anomaly Detector ─────────────────────────────────
from models.anomaly import detect_anomalies, detect_anomalies_all_cities

# ── K-Means City Clustering ──────────────────────────────────────────
from models.clustering import cluster_cities

# ── Rule-Based Health Risk Scorer ─────────────────────────────────────
from models.health_risk import (
    compute_health_risk,
    compute_health_risk_all_cities,
)

__all__ = [
    "forecast_city_aqi",
    "detect_anomalies",
    "detect_anomalies_all_cities",
    "cluster_cities",
    "compute_health_risk",
    "compute_health_risk_all_cities",
]
