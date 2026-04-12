const API_BASE = "/api";

function buildQueryString(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.append(key, String(value));
    }
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

async function request(path, params = {}) {
  const response = await fetch(`${API_BASE}${path}${buildQueryString(params)}`);

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch (error) {
      // Ignore JSON parse errors and use default message.
    }
    throw new Error(message);
  }

  return response.json();
}

export function fetchCities() {
  return request("/cities");
}

export function fetchDailyAqi({ cityId, startDate, endDate }) {
  return request("/aqi/daily", {
    cityId,
    startDate,
    endDate,
  });
}

export function fetchOverviewStats() {
  return request("/aqi/overview");
}

export function fetchHistoricalAqi({ cityId, month }) {
  return request("/aqi/historical", {
    cityId,
    month: Number(month) + 1,
  });
}

export function fetchQueryResult(queryId) {
  return request(`/aqi/query/${queryId}`);
}

