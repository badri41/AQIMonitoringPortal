const { executeQuery, executeCachedQuery } = require("../db/connections");

const GET_DAILY_BY_CITY_RANGE_QUERY = `
  SELECT date, aqi_daily AS avgAqi, pm25 AS avgPm25, pm10 AS avgPm10
  FROM aqi_data
  WHERE city_id = ?
    AND date BETWEEN ? AND ?
  ORDER BY date ASC;
`;

const GET_OVERVIEW_QUERY = `
  SELECT
    c.city_id,
    c.city_name,
    c.state,
    latest.date AS latestDate,
    latest.aqi_daily AS currentAqi,
    latest.pm25 AS currentPm25,
    latest.pm10 AS currentPm10,
    month_stats.avgAqi AS monthAvgAqi,
    month_stats.avgPm25 AS monthAvgPm25,
    month_stats.avgPm10 AS monthAvgPm10
  FROM cities c
  LEFT JOIN (
    SELECT d.city_id, d.date, d.aqi_daily, d.pm25, d.pm10
    FROM aqi_data d
    INNER JOIN (
      SELECT city_id, MAX(date) AS max_date
      FROM aqi_data
      GROUP BY city_id
    ) m
      ON m.city_id = d.city_id
     AND m.max_date = d.date
  ) latest
    ON latest.city_id = c.city_id
  LEFT JOIN (
    SELECT
      d.city_id,
      AVG(d.aqi_daily) AS avgAqi,
      AVG(d.pm25) AS avgPm25,
      AVG(d.pm10) AS avgPm10
    FROM aqi_data d
    INNER JOIN (
      SELECT city_id, YEAR(MAX(date)) AS latest_year, MONTH(MAX(date)) AS latest_month
      FROM aqi_data
      GROUP BY city_id
    ) lm
      ON lm.city_id = d.city_id
     AND YEAR(d.date) = lm.latest_year
     AND MONTH(d.date) = lm.latest_month
    GROUP BY d.city_id
  ) month_stats
    ON month_stats.city_id = c.city_id
  ORDER BY c.city_name;
`;

const GET_HISTORICAL_BY_CITY_MONTH_QUERY = `
  SELECT
    YEAR(date) AS year,
    ROUND(AVG(aqi_daily), 0) AS avgAqi,
    ROUND(AVG(pm25), 0) AS avgPm25,
    ROUND(AVG(pm10), 0) AS avgPm10
  FROM aqi_data
  WHERE city_id = ?
    AND MONTH(date) = ?
  GROUP BY YEAR(date)
  ORDER BY YEAR(date);
`;

// 1. 
// Which city experiences the longest consecutive duration of "Severe" AQI days in a year? 
// ➡ Use: window functions (streak calculation) 
// ➡ Insight: emergency intervention planning
const Q1 = `WITH severe_days AS (
    SELECT 
        city_id,
        date,
        YEAR(date) AS year,
        ROW_NUMBER() OVER (PARTITION BY city_id, YEAR(date) ORDER BY date) AS rn
    FROM aqi_data
    WHERE aqi_daily >= 401
),
grouped AS (
    SELECT 
        city_id,
        year,
        date,
        DATE_SUB(date, INTERVAL rn DAY) AS grp
    FROM severe_days
),
streaks AS (
    SELECT 
        city_id,
        year,
        COUNT(*) AS streak_length
    FROM grouped
    GROUP BY city_id, year, grp
)
SELECT 
    c.city_name,
    year,
    MAX(streak_length) AS longest_severe_streak
FROM streaks s
JOIN cities c ON s.city_id = c.city_id
GROUP BY c.city_name, year
ORDER BY longest_severe_streak DESC
LIMIT 15;`;

// -- Which state has shown the most improvement in average AQI over the last 3 years? 
// -- ➡ Use: yearly aggregation + difference 
// -- ➡ Insight: policy effectiveness
// We will first GROUP BY city_id, YEAR(date) the aqi_data table:
// This will reduce the number of rows from 28K to ~75. This will help while joining with cities table
const Q2 = `WITH city_yearly AS (
       SELECT 
           city_id,
           YEAR(date) AS year,
           SUM(aqi_daily) AS sum_aqi,
           COUNT(aqi_daily) AS count_aqi
       FROM aqi_data
       GROUP BY city_id, YEAR(date) 
),
state_yearly AS (
       SELECT 
           c1.state,
           c2.year,
           SUM(c2.sum_aqi) / SUM(c2.count_aqi) AS avg_aqi
       FROM city_yearly c2
       JOIN cities c1 ON c2.city_id = c1.city_id
       GROUP BY c1.state, c2.year
),

ranked AS (
    SELECT 
        state,
        year,
        avg_aqi,
        ROW_NUMBER() OVER (PARTITION BY state ORDER BY year DESC) AS rn
    FROM state_yearly
),
comparison AS (
    SELECT 
        s1.state,
        s1.avg_aqi AS latest_avg,
        s3.avg_aqi AS old_avg,
        (s3.avg_aqi - s1.avg_aqi) AS improvement
    FROM ranked s1
    JOIN ranked s3 
        ON s1.state = s3.state
    WHERE s1.rn = 1   -- latest year
      AND s3.rn = 3   -- 3rd latest year
)
SELECT *
FROM comparison
ORDER BY improvement DESC
LIMIT 7;`;

// -- On which dates did extreme AQI spikes occur in each city? 
// -- ➡ Use: anomaly threshold (mean + stddev or percentile) 
// -- ➡ ML tie-in: anomaly detection
// -- Here we have used the (mean + stddev) method to find spikes in each city
const Q3 = `WITH stats AS (
    SELECT 
        city_id,
        AVG(aqi_daily) AS mean_aqi,
        STDDEV(aqi_daily) AS std_aqi
    FROM aqi_data
    GROUP BY city_id
),

anomalies AS (
    SELECT 
        a.city_id,
        a.date,
        a.aqi_daily,
        s.mean_aqi,
        s.std_aqi,
        (s.mean_aqi + 2 * s.std_aqi) AS threshold
    FROM aqi_data a
    JOIN stats s ON a.city_id = s.city_id
    WHERE a.aqi_daily > (s.mean_aqi + 4 * s.std_aqi)
)

SELECT 
    c.city_name,
    a.date,
    a.aqi_daily,
    ROUND(a.mean_aqi, 2) AS mean_aqi,
    ROUND(a.std_aqi, 2) AS std_dev,
    ROUND(a.threshold, 2) AS threshold
FROM anomalies a
JOIN cities c ON a.city_id = c.city_id
ORDER BY c.city_name, a.date;
`;
// -- Which cities consistently remain in the "Good" AQI category across years? 
// -- ➡ Use: HAVING clause + threshold 
// -- ➡ Insight: benchmark cities 
const Q5 = `WITH yearly_avg AS (
    SELECT 
        city_id,
        YEAR(date) AS year,
        AVG(aqi_daily) AS avg_aqi
    FROM aqi_data
    GROUP BY city_id, YEAR(date)
)

SELECT c.city_name
FROM yearly_avg y
JOIN cities c ON y.city_id = c.city_id
GROUP BY y.city_id, c.city_name
HAVING MAX(y.avg_aqi) <= 150;
`;
// -- Which cities have the highest number of "Severe" or "Very Poor" AQI days annually? 
// -- ➡ Use: category count grouping 
// -- ➡ Insight: pollution hotspots 

const Q4 = `SELECT 
    c.city_name,
    t.year,
    t.very_poor_days,
    t.severe_days
FROM (
    SELECT 
        city_id,
        YEAR(date) AS year,
        SUM(CASE WHEN aqi_daily BETWEEN 401 AND 500 THEN 1 ELSE 0 END) AS very_poor_days,
        SUM(CASE WHEN aqi_daily >= 501 THEN 1 ELSE 0 END) AS severe_days
    FROM aqi_data
    GROUP BY city_id, YEAR(date)
) t
JOIN cities c ON t.city_id = c.city_id
WHERE (t.very_poor_days + t.severe_days) > 0
ORDER BY (t.very_poor_days + t.severe_days) DESC;`;

// -- What is the monthly average AQI for each city over the last 5 years? 
// -- ➡ Use: GROUP BY month, city 
// -- ➡ Visualization: line chart 

const Q6 = `SELECT 
    c.city_name,
    agg.year,
    agg.month,
    agg.avg_monthly_aqi
FROM (
    SELECT 
        city_id,
        YEAR(date) AS year,
        MONTH(date) AS month,
        ROUND(AVG(aqi_daily), 2) AS avg_monthly_aqi
    FROM aqi_data
    GROUP BY city_id, YEAR(date), MONTH(date)
) agg
JOIN cities c ON agg.city_id = c.city_id
ORDER BY 
    c.city_name,
    agg.year,
    agg.month;
`;

// What is the monthly average PM2.5 level for each city? 
// ➡ ML: seasonal pattern detection


const Q7 = `SELECT 
    c.city_name,
    agg.year,
    agg.month,
    agg.avg_pm25
FROM (
    SELECT 
        city_id,
        YEAR(date) AS year,
        MONTH(date) AS month,
        ROUND(AVG(pm25), 2) AS avg_pm25
    FROM aqi_data
    GROUP BY city_id, YEAR(date), MONTH(date)
) agg
JOIN cities c ON agg.city_id = c.city_id
ORDER BY 
    c.city_name,
    agg.year,
    agg.month;
`;

// -- What is the yearly growth or decline rate of AQI in each city? 
// -- ➡ Use: (current - previous)/previous 
// -- ➡ Window function: LAG() 
// -- (current − previous) / previous × 100 : growth/decline rate of AQI in each city:

const Q8 = `WITH yearly_avg AS (
    SELECT 
        city_id,
        YEAR(date) AS year,
        AVG(aqi_daily) AS avg_aqi
    FROM aqi_data
    GROUP BY city_id, YEAR(date)
),
with_lag AS (
    SELECT 
        city_id,
        year,
        avg_aqi,
        LAG(avg_aqi) OVER (PARTITION BY city_id ORDER BY year) AS prev_year_aqi
    FROM yearly_avg
)
SELECT 
    c.city_name,
    w.year,
    ROUND(w.avg_aqi, 2) AS current_avg_aqi,
    ROUND(w.prev_year_aqi, 2) AS prev_year_aqi,
    ROUND(
        (w.avg_aqi - w.prev_year_aqi) / w.prev_year_aqi * 100,
        2
    ) AS growth_rate_percent
FROM with_lag w
JOIN cities c ON w.city_id = c.city_id
WHERE w.prev_year_aqi IS NOT NULL
ORDER BY c.city_name, w.year;
`;

// Which month has the worst air quality (highest avg AQI) each year? 
// ➡ Use: MAX over grouped data 
const Q9 = `WITH monthly_avg AS (
    SELECT 
        YEAR(date) AS year,
        MONTH(date) AS month,
        AVG(aqi_daily) AS avg_aqi
    FROM aqi_data
    GROUP BY YEAR(date), MONTH(date)
),
ranked AS (
    SELECT 
        year,
        month,
        avg_aqi,
        ROW_NUMBER() OVER (PARTITION BY year ORDER BY avg_aqi DESC) AS rn
    FROM monthly_avg
)
SELECT 
    year,
    month,
    ROUND(avg_aqi, 2) AS worst_avg_aqi
FROM ranked
WHERE rn = 1
ORDER BY year;`;

// How do PM2.5 levels fluctuate between summer and winter months in Northern India? 
// ➡ Use: CASE (season classification)

// const Q10 = `SELECT 
//     c.city_name,
//     CASE 
//         WHEN MONTH(a.date) IN (12, 1, 2) THEN 'Winter'
//         WHEN MONTH(a.date) IN (4, 5, 6) THEN 'Summer'
//     END AS season,
//     ROUND(AVG(a.pm25), 2) AS avg_pm25
// FROM aqi_data a
// JOIN cities c ON a.city_id = c.city_id
// WHERE c.city_name IN ('Delhi', 'Noida', 'Lucknow', 'Chandigarh', 'Jaipur')
// AND MONTH(a.date) IN (12, 1, 2, 4, 5, 6)
// GROUP BY 
//     c.city_name,
//     season
// ORDER BY 
//     c.city_name,
//     season;
// `;

const Q10 = `
       WITH north AS (
          SELECT city_id, city_name
          FROM cities
          WHERE region = 'North'
),
       seasonal_avg AS (
          SELECT city_id,
          CASE 
             WHEN MONTH(date) IN (12,1,2) THEN 'Winter'
             WHEN MONTH(date) IN (4,5,6) THEN 'Summer'
          END AS season,
          AVG(pm25) AS avg_pm25
          FROM aqi_data
          WHERE city_id IN (SELECT city_id FROM north)
          AND MONTH(date) IN (12,1,2,4,5,6)
          GROUP BY 
             city_id,
             CASE
                WHEN MONTH(date) IN (12,2,1) THEN 'Winter'
                WHEN MONTH(date) IN (4,5,6) THEN 'Summer'
             END
        )
    SELECT 
       t1.city_name,
       s1.season,
       ROUND(s1.avg_pm25,2) AS avg_pm25
    FROM seasonal_avg s1
    JOIN north t1 ON s1.city_id = t1.city_id
    ORDER BY
       t1.city_name,
       s1.season;
`;

// Which pollutant (PM2.5 or PM10) dominates AQI in each city?
const Q11 = `
SELECT 
    c.city_name,
    agg.corr_pm25,
    agg.corr_pm10,
    agg.dominant_pollutant
FROM (
    SELECT 
        city_id,
        (
            (AVG(pm25 * aqi_daily) - AVG(pm25) * AVG(aqi_daily)) /
            (STDDEV(pm25) * STDDEV(aqi_daily))
        ) AS corr_pm25,
        (
            (AVG(pm10 * aqi_daily) - AVG(pm10) * AVG(aqi_daily)) /
            (STDDEV(pm10) * STDDEV(aqi_daily))
        ) AS corr_pm10,
        CASE
            WHEN 
                (
                    (AVG(pm25 * aqi_daily) - AVG(pm25) * AVG(aqi_daily)) /
                    (STDDEV(pm25) * STDDEV(aqi_daily))
                )
                >
                (
                    (AVG(pm10 * aqi_daily) - AVG(pm10) * AVG(aqi_daily)) /
                    (STDDEV(pm10) * STDDEV(aqi_daily))
                )
            THEN 'PM2.5 dominates AQI'
            WHEN 
                (
                    (AVG(pm25 * aqi_daily) - AVG(pm25) * AVG(aqi_daily)) /
                    (STDDEV(pm25) * STDDEV(aqi_daily))
                )
                <
                (
                    (AVG(pm10 * aqi_daily) - AVG(pm10) * AVG(aqi_daily)) /
                    (STDDEV(pm10) * STDDEV(aqi_daily))
                )
            THEN 'PM10 dominates AQI'
            ELSE 'Equal influence'
        END AS dominant_pollutant
    FROM aqi_data
    GROUP BY city_id
) AS agg
JOIN cities c ON agg.city_id = c.city_id
ORDER BY c.city_name;
`;

//What is the correlation between PM2.5 and overall AQI across cities?
const Q12 = `
SELECT 
    c.city_name,
    agg.corr_pm25_aqi
FROM (
    SELECT 
        city_id,
        (
            (AVG(pm25 * aqi_daily) - AVG(pm25) * AVG(aqi_daily)) /
            NULLIF(STDDEV(pm25) * STDDEV(aqi_daily), 0)
        ) AS corr_pm25_aqi
    FROM aqi_data
    GROUP BY city_id
) AS agg
JOIN cities c 
    ON agg.city_id = c.city_id
ORDER BY c.city_name;
` ;

//Which cities show increasing PM2.5 trends but stable overall AQI?
const Q13 = `
WITH DateRange AS (
    -- CTE 1: Calculate the exact midpoint only ONCE
    SELECT 
        MIN(date) + INTERVAL (DATEDIFF(MAX(date), MIN(date)) / 2) DAY AS midpoint
    FROM 
        aqi_data
),
CityTrends AS (
    -- CTE 2: Early aggregation on integers, using the midpoint
    SELECT 
        a.city_id,
        AVG(CASE WHEN a.date >= d.midpoint THEN a.pm25 END) - 
        AVG(CASE WHEN a.date < d.midpoint THEN a.pm25 END) AS pm25_diff,
        
        AVG(CASE WHEN a.date >= d.midpoint THEN a.aqi_daily END) - 
        AVG(CASE WHEN a.date < d.midpoint THEN a.aqi_daily END) AS aqi_diff
    FROM 
        aqi_data a
    CROSS JOIN 
        DateRange d
    GROUP BY 
        a.city_id
    HAVING 
        pm25_diff > 0 
        AND ABS(aqi_diff) < 10
)
-- Final Query: Only join the matching, pre-calculated rows to the text table
SELECT 
    c.city_name,
    ROUND(ct.pm25_diff, 2) AS pm25_diff,
    ROUND(ct.aqi_diff, 2) AS aqi_diff
FROM 
    cities c
JOIN 
    CityTrends ct ON c.city_id = ct.city_id
ORDER BY 
    ct.pm25_diff DESC;
`;

//What is the average AQI during weekends vs weekdays in each city?
const Q14 = `
WITH cityAvg AS (
SELECT 
    city_id,
    AVG(CASE WHEN DAYOFWEEK(date) BETWEEN 2 AND 6 THEN aqi_daily END) AS avg_weekday_aqi,
    AVG(CASE WHEN DAYOFWEEK(date) IN (1, 7) THEN aqi_daily END) AS avg_weekend_aqi
FROM 
    aqi_data
GROUP BY
    city_id
)
SELECT
    c.city_name,
    c1.avg_weekday_aqi,
    c1.avg_weekend_aqi
FROM
    cities c
JOIN 
    cityAvg c1 ON c.city_id = c1.city_id
ORDER BY 
    c.city_name;
`;

//How frequently do AQI levels change drastically (high volatility)?
const Q15 = `
WITH aqi_with_previous AS (
    SELECT 
        city_id,
        date,
        aqi_daily,
        LAG(aqi_daily) OVER (PARTITION BY city_id ORDER BY date) AS prev_aqi
    FROM 
        aqi_data
)
SELECT 
    c.city_name,
    COUNT(*) AS total_days_measured,
    SUM(CASE WHEN ABS(a.aqi_daily - a.prev_aqi) > 50 THEN 1 ELSE 0 END) AS frequent_drastic_changes
FROM 
    aqi_with_previous a
JOIN 
    cities c ON a.city_id = c.city_id
WHERE 
    a.prev_aqi IS NOT NULL
GROUP BY 
    c.city_name
ORDER BY 
    frequent_drastic_changes DESC;
`;

//Which cities have the most unpredictable AQI patterns?
//Which cities have the most unpredictable AQI patterns?
const Q16 = `
SELECT 
    c.city_name,
    ROUND(STDDEV(a.aqi_daily), 2) AS aqi_volatility_score
FROM 
    cities c
JOIN 
    aqi_data a ON c.city_id = a.city_id
GROUP BY 
    c.city_name
ORDER BY 
    aqi_volatility_score DESC;
`;
//What is the average duration (in days) of continuous polluted air spells (AQI > 200)?
const Q17 = `
WITH BadAirDays AS (
    
    SELECT 
        city_id,
        date,
        DATE_SUB(date, INTERVAL ROW_NUMBER() OVER (PARTITION BY city_id ORDER BY date) DAY) AS streak_group
    FROM 
        aqi_data
    WHERE 
        aqi_daily > 200
),

StreakLengths AS (
    SELECT 
        city_id,
        streak_group,
        COUNT(*) AS streak_duration
    FROM 
        BadAirDays
    GROUP BY 
        city_id, 
        streak_group
)

SELECT 
    c.city_name,
    ROUND(AVG(s.streak_duration), 1) AS avg_polluted_streak_days
FROM 
    StreakLengths s
JOIN 
    cities c ON s.city_id = c.city_id
GROUP BY 
    c.city_name
ORDER BY 
    avg_polluted_streak_days DESC;
`;

//How does AQI change before and after rainfall events?
const Q18 = `
WITH CitySeasonalAQI AS (
    SELECT 
        city_id,
        AVG(CASE WHEN MONTH(date) IN (4, 5) THEN aqi_daily END) AS raw_pre_rain_aqi,
        AVG(CASE WHEN MONTH(date) IN (10, 11) THEN aqi_daily END) AS raw_post_rain_aqi
    FROM 
        aqi_data
    GROUP BY 
        city_id
)
SELECT 
    c.city_name,
    ROUND(c1.raw_pre_rain_aqi, 1) AS pre_rainfall_aqi,
    ROUND(c1.raw_post_rain_aqi, 1) AS post_rainfall_aqi,
    ROUND(c1.raw_pre_rain_aqi - c1.raw_post_rain_aqi, 1) AS cleansing_impact_drop
FROM 
    cities c
JOIN 
    CitySeasonalAQI c1 ON c.city_id = c1.city_id
ORDER BY 
    cleansing_impact_drop DESC;
`;

//Which cities show the fastest AQI recovery after extreme pollution days?
const Q19 = `
WITH ExtremeDays AS (
    SELECT 
        city_id, 
        date AS extreme_date
    FROM 
        aqi_data
    WHERE 
        aqi_daily > 300
),
RecoveryEvents AS (
   
    SELECT 
        e.city_id,
        e.extreme_date,
        MIN(a.date) AS recovery_date
    FROM 
        ExtremeDays e
    LEFT JOIN 
        aqi_data a ON e.city_id = a.city_id 
                   AND a.date > e.extreme_date 
                   AND a.aqi_daily <= 100
    GROUP BY 
        e.city_id, 
        e.extreme_date
)

SELECT 
    c.city_name,
    COUNT(r.extreme_date) AS total_extreme_events,
    ROUND(AVG(DATEDIFF(r.recovery_date, r.extreme_date)), 1) AS avg_recovery_days
FROM 
    RecoveryEvents r
JOIN 
    cities c ON r.city_id = c.city_id
WHERE 
    r.recovery_date IS NOT NULL 
GROUP BY 
    c.city_name
ORDER BY 
    avg_recovery_days ASC;
`;
//How do pollution profiles (Gas vs. Particulate) differ across macro-regions?
const Q20 = `
SELECT 
    c.region,
    ROUND(AVG(COALESCE(a.co, 0) + COALESCE(a.no2, 0) + COALESCE(a.o3, 0)), 2) AS avg_chemical_pollution,
    
    ROUND(AVG(COALESCE(a.pm10, 0) + COALESCE(a.pm25, 0)), 2) AS avg_particulate_pollution,

    ROUND(
        AVG(COALESCE(a.co, 0) + COALESCE(a.no2, 0) + COALESCE(a.o3, 0)) / 
        NULLIF(AVG(COALESCE(a.pm10, 0) + COALESCE(a.pm25, 0)), 0), 
    4) AS gas_to_pm_ratio,
    
    CASE 
        WHEN AVG(COALESCE(a.co, 0) + COALESCE(a.no2, 0) + COALESCE(a.o3, 0)) > AVG(COALESCE(a.pm10, 0) + COALESCE(a.pm25, 0)) 
        THEN 'Primarily Chemical (Gas)'
        ELSE 'Primarily Particulate'
    END AS pollution_profile
FROM 
    cities c
JOIN 
    aqi_data a ON c.city_id = a.city_id
GROUP BY 
    c.region
ORDER BY 
    gas_to_pm_ratio DESC;
`;

//Which region experiences the earliest onset of winter pollution spikes?
const Q21 = `
WITH RegionalDaily AS (
    SELECT 
        c.region,
        a.date,
        AVG(a.pm25) AS daily_pm25
    FROM 
        cities c
    JOIN 
        aqi_data a ON c.city_id = a.city_id
    WHERE 
        a.pm25 IS NOT NULL
        -- Pre-filter to only the months needed (including Aug for the 7-day lookback)
        AND MONTH(a.date) BETWEEN 8 AND 12 
    GROUP BY 
        c.region, 
        a.date
),
MovingAverages AS (
    SELECT 
        region,
        date,
        AVG(daily_pm25) OVER (
            PARTITION BY region 
            ORDER BY date 
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) AS pm25_7day_avg
    FROM 
        RegionalDaily
),
WinterOnset AS (
    SELECT 
        region,
        YEAR(date) AS onset_year,
        MIN(date) AS first_spike_date
    FROM 
        MovingAverages
    WHERE 
        pm25_7day_avg > 100           
        AND MONTH(date) IN (9, 10, 11, 12) 
    GROUP BY 
        region, 
        YEAR(date)
)
SELECT 
    onset_year,
    region,
    first_spike_date
FROM 
    WinterOnset
ORDER BY 
    onset_year DESC, 
    first_spike_date ASC;
`;
//What are the 90th and 95th percentile pollution levels for each state?
const Q22 = `
SELECT DISTINCT
    c.state,
    ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY a.aqi_daily) OVER (PARTITION BY c.state), 1) AS aqi_90th_percentile,
    
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY a.aqi_daily) OVER (PARTITION BY c.state), 1) AS aqi_95th_percentile
FROM 
    cities c
JOIN 
    aqi_data a ON c.city_id = a.city_id
WHERE 
    a.aqi_daily IS NOT NULL
ORDER BY 
    aqi_95th_percentile DESC;
`;

//How does ground-level Ozone (O3) vary across seasons, specifically comparing peak summer to winter months?
const Q23 = `
WITH SeasonalOzone AS (
    SELECT 
        city_id,
        AVG(CASE WHEN MONTH(date) IN (3, 4, 5, 6) THEN o3 END) AS raw_summer_o3,
        AVG(CASE WHEN MONTH(date) IN (11, 12, 1, 2) THEN o3 END) AS raw_winter_o3
    FROM 
        aqi_data
    WHERE 
        o3 IS NOT NULL
    GROUP BY 
        city_id
)
SELECT 
    c.city_name,
    ROUND(so.raw_summer_o3, 2) AS avg_summer_o3,
    ROUND(so.raw_winter_o3, 2) AS avg_winter_o3,
    ROUND(so.raw_summer_o3 - so.raw_winter_o3, 2) AS summer_spike_difference
FROM 
    cities c
JOIN 
    SeasonalOzone so ON c.city_id = so.city_id
ORDER BY 
    summer_spike_difference DESC;
`;

//Which cities exhibit the highest ratio of NO2 to overall AQI, indicating heavy traffic pollution?
const Q24 = `
WITH CityNO2Stats AS (
    SELECT 
        city_id,
        AVG(no2) AS raw_avg_no2,
        AVG(aqi_daily) AS raw_avg_aqi
    FROM 
        aqi_data
    WHERE 
        no2 IS NOT NULL 
        AND aqi_daily IS NOT NULL
    GROUP BY 
        city_id
)
SELECT 
    c.city_name,
    ROUND(cns.raw_avg_no2, 2) AS avg_no2,
    ROUND(cns.raw_avg_aqi, 2) AS avg_overall_aqi,
    ROUND(cns.raw_avg_no2/NULLIF(cns.raw_avg_aqi, 0), 4) AS traffic_pollution_ratio
FROM 
    cities c
JOIN 
    CityNO2Stats cns ON c.city_id = cns.city_id
ORDER BY 
    traffic_pollution_ratio DESC;
`;

//What is the co-occurrence rate of CO and PM2.5 spikes during winter months?
const Q25 = `
WITH WinterData AS (
    SELECT 
        city_id,
        co,
        pm25
    FROM 
        aqi_data
    WHERE 
        MONTH(date) IN (11, 12, 1, 2)
        AND co IS NOT NULL 
        AND pm25 IS NOT NULL
),
Thresholds AS (
    SELECT 
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY co) OVER () AS co_threshold,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY pm25) OVER () AS pm25_threshold
    FROM 
        WinterData
    LIMIT 1
)
SELECT 
    c.city_name,
    COUNT(*) AS total_winter_days,
    SUM(CASE WHEN wd.co > t.co_threshold AND wd.pm25 > t.pm25_threshold THEN 1 ELSE 0 END) AS co_pm_simultaneous_spikes,
    ROUND(
        (SUM(CASE WHEN wd.co > t.co_threshold AND wd.pm25 > t.pm25_threshold THEN 1 ELSE 0 END) / COUNT(*)) * 100, 
    2) AS co_occurrence_rate_percent
FROM 
    WinterData wd
JOIN 
    cities c ON wd.city_id = c.city_id
CROSS JOIN 
    Thresholds t
GROUP BY 
    c.city_name
ORDER BY 
    co_occurrence_rate_percent DESC;
`;

//Are there "hidden hazard" days where O3 or CO levels are dangerous, but the overall AQI remains "Good" or "Satisfactory"?
const Q26 = `
SELECT 
    c.city_name,
    a.date,
    a.aqi_daily AS reported_overall_aqi,
    a.o3 AS ozone_level,
    a.co AS carbon_monoxide_level,
    CASE 
        WHEN a.o3 > 200 THEN 'High Ozone Hazard'
        WHEN a.co > 2.5 THEN 'High CO Hazard'
        ELSE 'Moderate Gas Risk'
    END AS hazard_type
FROM 
    aqi_data a
JOIN 
    cities c ON a.city_id = c.city_id
WHERE 
    a.aqi_daily <= 100 
    AND (
        a.o3 > 200     
        OR a.co > 2.5  
    )
ORDER BY 
    a.date DESC;
`;

// -- Which cities show the fastest AQI recovery after severe pollution days? 
// -- ➡ Use: time-to-normal calculation 

const Q27 = `
WITH severe_days AS (
    SELECT 
        city_id,
        date AS severe_date
    FROM aqi_data
    WHERE aqi_daily >= 401
),

recovery_days AS (
    SELECT 
        s.city_id,
        s.severe_date,
        MIN(a.date) AS recovery_date
    FROM severe_days s
    JOIN aqi_data a 
        ON s.city_id = a.city_id
        AND a.date > s.severe_date
        AND a.aqi_daily <= 100
    GROUP BY s.city_id, s.severe_date
),

recovery_time AS (
    SELECT 
        city_id,
        DATEDIFF(recovery_date, severe_date) AS recovery_days
    FROM recovery_days
)

SELECT 
    c.city_name,
    ROUND(AVG(recovery_days), 2) AS avg_recovery_time
FROM recovery_time r
JOIN cities c ON r.city_id = c.city_id
GROUP BY c.city_name
ORDER BY avg_recovery_time ASC;
`;
// --  How many days before severe AQI does PM2.5 cross critical levels?
// -- ➡ Early warning signal

const Q28 = `
WITH severe_days AS (
    SELECT city_id, date
    FROM aqi_data
    WHERE aqi_daily >= 401
),
pre_spike AS (
    SELECT 
        s.city_id,
        MAX(a.date) AS warning_date,
        s.date AS severe_date
    FROM severe_days s
    JOIN aqi_data a
        ON s.city_id = a.city_id
        AND a.date < s.date
        AND a.pm25 >= 200
    GROUP BY s.city_id, s.date
)
SELECT 
    c.city_name,
    ROUND(AVG(DATEDIFF(severe_date, warning_date)), 2) AS avg_warning_days
FROM pre_spike p
JOIN cities c ON p.city_id = c.city_id
GROUP BY c.city_name
ORDER BY avg_warning_days DESC;
`;

// --  Which cities have the sharpest winter-to-summer AQI drop?
// -- ➡ Seasonal contrast strength

const Q29 = `SELECT 
    c.city_name,
    ROUND(a.seasonal_drop, 2) AS seasonal_drop
FROM 
    cities c
JOIN (
    SELECT 
        city_id,
        AVG(CASE WHEN MONTH(date) IN (12,1,2) THEN aqi_daily END) -
        AVG(CASE WHEN MONTH(date) IN (4,5,6) THEN aqi_daily END) AS seasonal_drop
    FROM 
        aqi_data
    GROUP BY 
        city_id
) a ON c.city_id = a.city_id
ORDER BY 
    seasonal_drop DESC;`;
// --  Do severe AQI days cluster together (burst analysis)?
// -- ➡ Identify clustered extreme events
// -- This will show the longest cluster per city.

const Q30 = `WITH severe_days AS (
    SELECT 
        city_id,
        date,
        ROW_NUMBER() OVER (PARTITION BY city_id ORDER BY date) AS rn
    FROM aqi_data
    WHERE aqi_daily >= 401
),

grouped AS (
    SELECT 
        city_id,
        DATE_SUB(date, INTERVAL rn DAY) AS grp
    FROM severe_days
),

clusters AS (
    SELECT 
        city_id,
        COUNT(*) AS cluster_size
    FROM grouped
    GROUP BY city_id, grp
)

SELECT 
    c.city_name,
    MAX(cluster_size) AS longest_cluster
FROM clusters cl
JOIN cities c ON cl.city_id = c.city_id
GROUP BY c.city_name
ORDER BY longest_cluster DESC;`;


async function findDailyByCityAndRange(cityId, startDate, endDate) {
    return executeCachedQuery(GET_DAILY_BY_CITY_RANGE_QUERY, [cityId, startDate, endDate], 120000);
}

async function findOverviewStats() {
    return executeCachedQuery(GET_OVERVIEW_QUERY, [], 120000);
}

async function findHistoricalByCityMonth(cityId, month) {
    return executeCachedQuery(GET_HISTORICAL_BY_CITY_MONTH_QUERY, [cityId, month], 10 * 60 * 1000);
}
// Q1
async function getLongestSevereStreak() {
    return executeCachedQuery(Q1, [], 10 * 60 * 1000);
}

// Q2
async function getStateImprovement() {
    return executeCachedQuery(Q2, [], 10 * 60 * 1000);
}

// Q3
async function getAQIAnomalies() {
    return executeCachedQuery(Q3, [], 10 * 60 * 1000);
}

// Q4
async function getPollutionHotspots() {
    return executeCachedQuery(Q4, [], 10 * 60 * 1000);
}

// Q5
async function getConsistentlyGoodCities() {
    return executeCachedQuery(Q5, [], 10 * 60 * 1000);
}

// Q6
async function getMonthlyAQI() {
    return executeCachedQuery(Q6, [], 10 * 60 * 1000);
}

// Q7
async function getMonthlyPM25() {
    return executeCachedQuery(Q7, [], 10 * 60 * 1000);
}

// Q8
async function getYearlyGrowth() {
    return executeCachedQuery(Q8, [], 10 * 60 * 1000);
}

// Q9
async function getWorstMonthPerYear() {
    return executeCachedQuery(Q9, [], 10 * 60 * 1000);
}

// Q10
async function getSeasonalPM25() {
    return executeCachedQuery(Q10, [], 10 * 60 * 1000);
}


async function getDominantPollutant() {
    return executeCachedQuery(Q11, [], 10 * 60 * 1000);
}

async function getPm25AqiCorrelation() {
    return executeCachedQuery(Q12, [], 10 * 60 * 1000);
}

async function getHiddenPollutionRisk() {
    return executeCachedQuery(Q13, [], 10 * 60 * 1000);
}

async function getWeekendVsWeekdayAQI() {
    return executeCachedQuery(Q14, [], 10 * 60 * 1000);
}

async function getAqiVolatilityFrequency() {
    return executeCachedQuery(Q15, [], 10 * 60 * 1000);
}

async function getUnpredictableCities() {
    return executeCachedQuery(Q16, [], 10 * 60 * 1000);
}

async function getPollutedAirSpells() {
    return executeCachedQuery(Q17, [], 10 * 60 * 1000);
}

async function getRainfallImpact() {
    return executeCachedQuery(Q18, [], 10 * 60 * 1000);
}

async function getRecoverySpeed() {
    return executeCachedQuery(Q19, [], 10 * 60 * 1000);
}

async function getRegionalPollutionProfile() {
    return executeCachedQuery(Q20, [], 10 * 60 * 1000);
}

async function getWinterOnset() {
    return executeCachedQuery(Q21, [], 10 * 60 * 1000);
}

async function getStatePercentiles() {
    return executeCachedQuery(Q22, [], 10 * 60 * 1000);
}

async function getSeasonalOzoneVariation() {
    return executeCachedQuery(Q23, [], 10 * 60 * 1000);
}

async function getTrafficPollution() {
    return executeCachedQuery(Q24, [], 10 * 60 * 1000);
}

async function getCoPmCooccurrence() {
    return executeCachedQuery(Q25, [], 10 * 60 * 1000);
}

async function getHiddenHazardDays() {
    return executeCachedQuery(Q26, [], 10 * 60 * 1000);
}

// Q27
async function getRecoveryTime() {
    return executeCachedQuery(Q27, [], 10 * 60 * 1000);
}

// Q28
async function getEarlyWarningSignal() {
    return executeCachedQuery(Q28, [], 10 * 60 * 1000);
}

// Q29
async function getSeasonalDrop() {
    return executeCachedQuery(Q29, [], 10 * 60 * 1000);
}

// Q30
async function getPollutionClusters() {
    return executeCachedQuery(Q30, [], 10 * 60 * 1000);
}

/* ---------------- EXPORT ---------------- */

module.exports = {
    findDailyByCityAndRange,
    findOverviewStats,
    findHistoricalByCityMonth,

    getLongestSevereStreak,
    getStateImprovement,
    getAQIAnomalies,
    getPollutionHotspots,
    getConsistentlyGoodCities,
    getMonthlyAQI,
    getMonthlyPM25,
    getYearlyGrowth,
    getWorstMonthPerYear,
    getSeasonalPM25,
    getRecoveryTime,
    getEarlyWarningSignal,
    getSeasonalDrop,
    getPollutionClusters,

    getDominantPollutant,
    getPm25AqiCorrelation,
    getHiddenPollutionRisk,
    getWeekendVsWeekdayAQI,
    getAqiVolatilityFrequency,
    getUnpredictableCities,
    getPollutedAirSpells,
    getRainfallImpact,
    getRecoverySpeed,
    getRegionalPollutionProfile,
    getWinterOnset,
    getStatePercentiles,
    getSeasonalOzoneVariation,
    getTrafficPollution,
    getCoPmCooccurrence,
    getHiddenHazardDays
};
