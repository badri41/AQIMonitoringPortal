"""
City Clustering — Groups cities with similar pollution patterns using K-Means.

Model: sklearn.cluster.KMeans  +  PCA for dimensionality reduction

Why K-Means:
    We want to find natural groupings among cities based on their
    multi-dimensional pollution profiles (avg AQI, PM2.5, PM10,
    volatility, seasonal ratio). K-Means partitions cities into K
    groups minimizing within-cluster variance, giving clear, interpretable
    clusters like "clean cities," "seasonal polluters," "chronic polluters."

    PCA is used to reduce the feature space to 2D for visualization while
    preserving maximum variance.

Why not DBSCAN:
    With ~20-25 cities, K-Means is simpler, more predictable, and gives
    fixed cluster counts. DBSCAN can leave cities as "noise" which isn't
    useful for our comparison use case.
"""
import os
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

from config import (
    KMEANS_MAX_K,
    PLOT_DPI, PLOT_BG_COLOR, PLOT_TEXT_COLOR, PLOT_ACCENT_COLORS,
)


def cluster_cities(city_features_df, output_dir, n_clusters=None):
    """
    Cluster cities based on their aggregate pollution features.
    Saves:
      - clusters_pca.png: 2D PCA scatter with cluster colors
      - elbow_plot.png: elbow method for optimal K
      - clusters.json: city → cluster mapping + centroids
    """
    os.makedirs(output_dir, exist_ok=True)

    feature_cols = [c for c in city_features_df.columns if c != "city"]
    X = city_features_df[feature_cols].fillna(0).values
    cities = city_features_df["city"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── Elbow Method ──────────────────────────────────────────────────
    max_k = min(KMEANS_MAX_K, len(cities) - 1)
    inertias = []
    K_range = range(2, max_k + 1)

    for k in K_range:
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        km.fit(X_scaled)
        inertias.append(km.inertia_)

    # Auto-detect optimal K using "knee" heuristic
    if n_clusters is None:
        diffs = np.diff(inertias)
        diffs2 = np.diff(diffs)
        if len(diffs2) > 0:
            n_clusters = int(np.argmax(diffs2) + 3)  # +2 for K offset, +1 for diff offset
            n_clusters = min(max(n_clusters, 3), max_k)
        else:
            n_clusters = 3

    # Elbow plot
    fig, ax = plt.subplots(figsize=(10, 5), facecolor=PLOT_BG_COLOR)
    ax.set_facecolor(PLOT_BG_COLOR)
    ax.plot(list(K_range), inertias, "o-", color=PLOT_ACCENT_COLORS[0],
            linewidth=2, markersize=8)
    ax.axvline(x=n_clusters, color=PLOT_ACCENT_COLORS[1], linestyle="--",
               linewidth=2, label=f"Optimal K = {n_clusters}")
    ax.set_title("Elbow Method — Optimal Number of City Clusters",
                 color=PLOT_TEXT_COLOR, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel("Number of Clusters (K)", color=PLOT_TEXT_COLOR, fontsize=11)
    ax.set_ylabel("Inertia (Within-Cluster Sum of Squares)", color=PLOT_TEXT_COLOR, fontsize=11)
    ax.tick_params(colors=PLOT_TEXT_COLOR, labelsize=9)
    ax.legend(facecolor="#2a2a3e", edgecolor="#444", labelcolor=PLOT_TEXT_COLOR, fontsize=10)
    for spine in ax.spines.values():
        spine.set_color("#444")
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "elbow_plot.png"), dpi=PLOT_DPI,
                facecolor=PLOT_BG_COLOR, bbox_inches="tight")
    plt.close(fig)

    # ── Final K-Means ─────────────────────────────────────────────────
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(X_scaled)

    # ── PCA → 2D ──────────────────────────────────────────────────────
    pca = PCA(n_components=2)
    X_2d = pca.fit_transform(X_scaled)
    explained = pca.explained_variance_ratio_

    fig, ax = plt.subplots(figsize=(12, 8), facecolor=PLOT_BG_COLOR)
    ax.set_facecolor(PLOT_BG_COLOR)

    cluster_names = {
        0: "Clean & Stable",
        1: "Moderate Seasonal",
        2: "High Pollution",
        3: "Extreme Chronic",
        4: "Volatile",
    }

    for cl in range(n_clusters):
        mask = labels == cl
        color = PLOT_ACCENT_COLORS[cl % len(PLOT_ACCENT_COLORS)]
        cname = cluster_names.get(cl, f"Cluster {cl}")
        ax.scatter(X_2d[mask, 0], X_2d[mask, 1],
                   color=color, s=120, alpha=0.85, edgecolors="white",
                   linewidths=1.5, label=cname, zorder=5)

        for i in np.where(mask)[0]:
            ax.annotate(
                cities[i], (X_2d[i, 0], X_2d[i, 1]),
                fontsize=8, color=PLOT_TEXT_COLOR, fontweight="bold",
                xytext=(5, 5), textcoords="offset points",
                bbox=dict(boxstyle="round,pad=0.2", facecolor=color, alpha=0.3),
            )

    ax.set_title("City Clustering by Pollution Profile (K-Means + PCA)",
                 color=PLOT_TEXT_COLOR, fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel(f"PC1 ({explained[0]*100:.1f}% variance)", color=PLOT_TEXT_COLOR, fontsize=11)
    ax.set_ylabel(f"PC2 ({explained[1]*100:.1f}% variance)", color=PLOT_TEXT_COLOR, fontsize=11)
    ax.tick_params(colors=PLOT_TEXT_COLOR, labelsize=9)
    ax.legend(facecolor="#2a2a3e", edgecolor="#444", labelcolor=PLOT_TEXT_COLOR,
              fontsize=10, loc="upper right")
    for spine in ax.spines.values():
        spine.set_color("#444")
    ax.grid(alpha=0.15, color="#555")

    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "clusters_pca.png"), dpi=PLOT_DPI,
                facecolor=PLOT_BG_COLOR, bbox_inches="tight")
    plt.close(fig)

    # ── JSON ──────────────────────────────────────────────────────────
    cluster_map = {}
    for i, city in enumerate(cities):
        cl = int(labels[i])
        if cl not in cluster_map:
            cluster_map[cl] = {
                "cluster_id": cl,
                "cluster_name": cluster_names.get(cl, f"Cluster {cl}"),
                "cities": [],
            }
        cluster_map[cl]["cities"].append({
            "city": city,
            "features": {col: round(float(city_features_df.iloc[i][col]), 2) for col in feature_cols},
        })

    result = {
        "model": "K-Means",
        "n_clusters": n_clusters,
        "features_used": feature_cols,
        "pca_explained_variance": [round(float(v), 4) for v in explained],
        "clusters": list(cluster_map.values()),
    }

    with open(os.path.join(output_dir, "clusters.json"), "w") as f:
        json.dump(result, f, indent=2)

    return labels, n_clusters
