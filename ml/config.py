"""
Central configuration for the ML pipeline.
All paths, constants, and AQI breakpoints live here.
"""
import os

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
CSV_PATH = os.path.join(PROJECT_DIR, "data", "csv", "merged", "final_merged_aqi_data.csv")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "frontend", "public", "ml-results")

# ── AQI Breakpoints (NAQI India) ──────────────────────────────────────────
AQI_CATEGORIES = [
    (0,   50,  "Good",          "#55a868", 0),
    (51,  100, "Satisfactory",  "#c4e17f", 1),
    (101, 200, "Moderate",      "#f5d76e", 2),
    (201, 300, "Poor",          "#f39c12", 4),
    (301, 400, "Very Poor",     "#e74c3c", 7),
    (401, 500, "Severe",        "#8e44ad", 10),
]

# ── Model Hyperparameters ─────────────────────────────────────────────────
LSTM_LOOKBACK = 30           # days of history fed to LSTM
LSTM_EPOCHS = 50
LSTM_BATCH_SIZE = 32
LSTM_FORECAST_DAYS = 365     # predict 1 year ahead

ISOLATION_FOREST_CONTAMINATION = 0.05   # expect ~5% anomalies

KMEANS_MAX_K = 10           # max clusters for elbow method

# ── Plot styling ──────────────────────────────────────────────────────────
PLOT_STYLE = "seaborn-v0_8-darkgrid"
PLOT_DPI = 150
PLOT_FIGSIZE = (12, 6)
PLOT_BG_COLOR = "#1a1a2e"
PLOT_TEXT_COLOR = "#e0e0e0"
PLOT_ACCENT_COLORS = [
    "#00d2ff", "#7c4dff", "#ff6e40", "#69f0ae",
    "#ffd740", "#ff4081", "#40c4ff", "#b388ff",
    "#ff9100", "#64ffda", "#ea80fc", "#84ffff",
]

# ── Query metadata ────────────────────────────────────────────────────────
QUERY_TITLES = {
    1:  "Longest Consecutive Severe AQI Days",
    2:  "State AQI Improvement Over Years",
    3:  "Extreme AQI Spike Detection (Anomalies)",
    4:  "Severe & Very Poor Day Counts (Hotspots)",
    5:  "Consistently Good AQI Cities",
    6:  "Monthly Average AQI per City",
    7:  "Monthly Average PM2.5 per City",
    8:  "Yearly AQI Growth/Decline Rate",
    9:  "Worst Air Quality Month Each Year",
    10: "Summer vs Winter PM2.5 (North India)",
    11: "Dominant Pollutant per City (PM2.5 vs PM10)",
    12: "PM2.5–AQI Correlation Across Cities",
    13: "Rising PM2.5 but Stable AQI Cities",
    14: "Weekday vs Weekend AQI",
    15: "AQI Volatility Frequency (Drastic Changes)",
    16: "Most Unpredictable AQI Cities",
    17: "Average Duration of Polluted Air Spells",
    18: "AQI Change Before & After Rainfall",
    19: "Fastest AQI Recovery After Extreme Days",
    20: "Gas vs Particulate Pollution by Region",
    21: "Earliest Winter Pollution Onset by Region",
    22: "90th & 95th Percentile Pollution by State",
    23: "Seasonal Ozone (O3) Variation",
    24: "NO2/AQI Ratio — Traffic Pollution Indicator",
    25: "CO & PM2.5 Co-occurrence in Winter",
    26: "Hidden Hazard Days (High O3/CO, Low AQI)",
    27: "Recovery Time After Extreme Pollution",
    28: "Early Warning: PM2.5 Before Severe AQI",
    29: "Sharpest Winter-to-Summer AQI Drop",
    30: "Severe AQI Burst Cluster Analysis",
}

QUERY_ML_TYPE = {
    1:  "trend_forecast",
    2:  "trend_forecast",
    3:  "anomaly",
    4:  "health_risk",
    5:  "clustering",
    6:  "lstm_forecast",
    7:  "lstm_forecast",
    8:  "trend_forecast",
    9:  "lstm_forecast",
    10: "trend_forecast",
    11: "clustering",
    12: "trend_analysis",
    13: "trend_analysis",
    14: "trend_analysis",
    15: "anomaly",
    16: "clustering",
    17: "health_risk",
    18: "trend_analysis",
    19: "health_risk",
    20: "clustering",
    21: "trend_forecast",
    22: "health_risk",
    23: "trend_analysis",
    24: "trend_analysis",
    25: "trend_analysis",
    26: "anomaly",
    27: "health_risk",
    28: "trend_analysis",
    29: "trend_analysis",
    30: "anomaly",
}
