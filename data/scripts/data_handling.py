import pandas as pd
import aiohttp
import asyncio
import os
import glob
import time
API_KEY = "YOUR_API_KEY" 
CITY_COORDS = {
    "chennai": "13.0827,80.2707",
    "chandigarh": "30.7333,76.7794",
    "bhopal": "23.2599,77.4126",
    "bangalore": "12.9716,77.5946",
    "pune": "18.5204,73.8567",
    "noida": "28.5355,77.3910",
    "newdelhi": "28.6139,77.2090", 
    "mumbai": "19.0760,72.8777",
    "lucknow": "26.8467,80.9462",
    "kolkata": "22.5726,88.3639",
    "jaipur": "26.9124,75.7873",
    "indore": "22.7196,75.8577",
    "hyderabad": "17.3850,78.4867",
    "guwahati": "26.1445,91.7362",
    "ahmedabad": "23.0225,72.5714"
}

RADIUS_METERS = 25000
HEADERS = {"X-API-Key": API_KEY, "Accept": "application/json"}
PARAMS = ['co', 'no2', 'o3', 'pm10', 'pm25']

MAX_CONCURRENT_REQUESTS = 5  
REQUIRED_READINGS = 2 
TIMEOUT = aiohttp.ClientTimeout(total=10)
MASTER_FILENAME = "master_aqi_data_2021_2026.csv"
async def fetch_with_retry(session, url, params, semaphore, retries=3):
    async with semaphore:
        for attempt in range(retries):
            try:
                async with session.get(url, headers=HEADERS, params=params, timeout=TIMEOUT) as response:
                    if response.status == 200:
                        return await response.json()
                    elif response.status == 429:
                        wait_time = 2 ** (attempt + 1)
                        print(f"      [Rate Limit] API paused us. Waiting {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        return None
            except asyncio.TimeoutError:
                pass
            except Exception:
                await asyncio.sleep(1)
        return None
async def get_city_sensors(session, city_name, coords, semaphore):
    url = "https://api.openaq.org/v3/locations"
    params = {"coordinates": coords, "radius": RADIUS_METERS, "limit": 1000}
    data = await fetch_with_retry(session, url, params, semaphore)
    sensors_by_param = {p: [] for p in PARAMS}
    if data and 'results' in data:
        for loc in data['results']:
            for sensor in loc.get('sensors', []):
                param_name = sensor.get('parameter', {}).get('name')
                sensor_id = sensor.get('id')
                if param_name in sensors_by_param and sensor_id:
                    sensors_by_param[param_name].append(sensor_id)
    return sensors_by_param
async def fetch_daily_avg_for_sensor(session, sensor_id, date_str, semaphore):
    url = f"https://api.openaq.org/v3/sensors/{sensor_id}/days"
    params = {
        "datetime_from": f"{date_str}T00:00:00Z",
        "datetime_to": f"{date_str}T23:59:59Z",
        "limit": 10
    }
    data = await fetch_with_retry(session, url, params, semaphore)
    if data and 'results' in data and data['results']:
        val = data['results'][0].get('value')
        if val is not None and val >= 0:
            return val
    return None
async def resolve_missing_value(session, df, index, param, date_str, sensor_ids, semaphore):
    if not sensor_ids:
        return 0  
    valid_values = []
    for sid in sensor_ids:
        val = await fetch_daily_avg_for_sensor(session, sid, date_str, semaphore)
        if val is not None:
            valid_values.append(val)
            if len(valid_values) >= REQUIRED_READINGS:
                break
    if valid_values:
        avg_value = round(sum(valid_values) / len(valid_values), 1)
        df.at[index, param] = avg_value
        print(f"      ✓ [{date_str} | {param.upper()}] Filled with {avg_value}")
        return 1
    else:
        print(f"      ✗ [{date_str} | {param.upper()}] No data available.")
        return 0
async def process_file(session, filepath, semaphore):
    filename = os.path.basename(filepath)
    city_key = filename.split('_')[0].lower() 
    if city_key not in CITY_COORDS:
        return
    print(f"\n--- Fetching Data for {filename} ---")
    df = pd.read_csv(filepath)
    sensors_map = await get_city_sensors(session, city_key, CITY_COORDS[city_key], semaphore)
    tasks = []
    for param in PARAMS:
        missing_rows = df[df[param].isnull()]
        for index, row in missing_rows.iterrows():
            date_str = row['date']
            sensor_ids = sensors_map.get(param, [])
            task = resolve_missing_value(session, df, index, param, date_str, sensor_ids, semaphore)
            tasks.append(task)
    out_filename = filepath.replace('.csv', '_filled.csv')
    if tasks:
        print(f"  Found {len(tasks)} missing data points. Processing in batches...")
        chunk_size = 50
        total_filled = 0
        for i in range(0, len(tasks), chunk_size):
            chunk = tasks[i:i + chunk_size]
            print(f"  -> Processing batch {i+1} to {min(i+chunk_size, len(tasks))} of {len(tasks)}...")
            filled_counts = await asyncio.gather(*chunk)
            total_filled += sum(filled_counts)
            df.to_csv(out_filename, index=False)   
        print(f"  ✓ Process complete! Saved {out_filename} ({total_filled} values filled).")
    else:
        df.to_csv(out_filename, index=False)
        print("  ✓ No missing values found. Saving as _filled.csv anyway.")
async def run_fetcher():
    csv_files = glob.glob("*_aqi_data_2021_2026.csv")
    csv_files = [f for f in csv_files if not f.endswith("_filled.csv") and f != MASTER_FILENAME]
    if not csv_files:
        print("No raw files found to process. Moving to combination phase...")
        return
    print(f"\n=== PHASE 1: FETCHING API DATA ({len(csv_files)} files) ===")
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT_REQUESTS, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for filepath in csv_files:
            await process_file(session, filepath, semaphore)
def combine_filled_csvs():
    print("\n=== PHASE 2: COMBINING FILES ===")
    csv_files = glob.glob("*_filled.csv")
    if not csv_files:
        print("No '_filled.csv' files found to combine. Stopping.")
        return False
    print(f"Found {len(csv_files)} filled files. Combining them now...")
    dataframes = []
    for file in csv_files:
        df = pd.read_csv(file)
        dataframes.append(df)
        print(f"  -> Merging {file} ({len(df)} rows)")
    combined_df = pd.concat(dataframes, ignore_index=True)
    if 'city' in combined_df.columns and 'date' in combined_df.columns:
        combined_df = combined_df.sort_values(by=['city', 'date'])
    combined_df.to_csv(MASTER_FILENAME, index=False)
    print(f"✅ Success! Saved unified dataset as '{MASTER_FILENAME}'.")
    return True
def polish_master_dataset():
    print(f"\n=== PHASE 3: POLISHING MASTER DATA ===")
    print(f"Loading {MASTER_FILENAME}...")
    if not os.path.exists(MASTER_FILENAME):
        print(f"Error: {MASTER_FILENAME} not found.")
        return
    df = pd.read_csv(MASTER_FILENAME)
    high_co_mask = df['co'] > 100
    high_co_count = high_co_mask.sum()
    if high_co_count > 0:
        df.loc[high_co_mask, 'co'] = (df.loc[high_co_mask, 'co'] / 1000.0).round(1)
        print(f"  ✓ Fixed {high_co_count} inflated CO values (converted µg/m³ to mg/m³).")
    else:
        print("  ✓ CO values look normal. No conversion needed.")
    null_count_before = df.isnull().sum().sum()
    if null_count_before > 0:
        print(f"  Found {null_count_before} stubborn null values left. Interpolating...")
        df = df.groupby('city', group_keys=False).apply(lambda group: group.interpolate(method='linear', limit_direction='both'))
        df = df.bfill().ffill()
        print("  ✓ All remaining null values have been mathematically patched.")
    else:
        print("  ✓ No null values found to patch.")
    df.to_csv(MASTER_FILENAME, index=False)
    print(f"\n✅ PIPELINE COMPLETE! Your dataset '{MASTER_FILENAME}' is 100% clean and ready.")
if __name__ == "__main__":
    start_time = time.time()
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run_fetcher())
    files_combined = combine_filled_csvs()
    if files_combined:
        polish_master_dataset()
    elapsed = time.time() - start_time
    print(f"\nTotal script execution time: {elapsed:.1f} seconds")
