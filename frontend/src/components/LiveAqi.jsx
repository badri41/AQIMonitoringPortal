import { useEffect, useState } from 'react';
import { getAqiCategory } from '../data/mockData';
import './LiveAqi.css';

const CITY_COORDINATES = {
  'Delhi': { lat: 28.6139, lon: 77.2090 },
  'Mumbai': { lat: 19.0760, lon: 72.8777 },
  'Kolkata': { lat: 22.5726, lon: 88.3639 },
  'Chennai': { lat: 13.0827, lon: 80.2707 },
  'Bengaluru': { lat: 12.9716, lon: 77.5946 },
  'Hyderabad': { lat: 17.3850, lon: 78.4867 },
  'Guwahati': { lat: 26.1445, lon: 91.7362 },
  'Lucknow': { lat: 26.8467, lon: 80.9462 },
};

export default function LiveAqi({ locationName }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!locationName) return;

    const coords = CITY_COORDINATES[locationName];
    if (!coords) {
      setError('Coordinates not available for this city');
      return;
    }

    let ignore = false;

    async function fetchLiveAqi() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coords.lat}&longitude=${coords.lon}&current=us_aqi`);
        const result = await response.json();

        if (!ignore) {
          if (result.current && result.current.us_aqi !== undefined) {
            setLiveData({
              aqi: result.current.us_aqi,
              time: result.current.time,
            });
          } else {
            setError('Failed to fetch live data');
          }
        }
      } catch (err) {
        if (!ignore) {
          setError('Failed to fetch live data');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchLiveAqi();

    return () => {
      ignore = true;
    };
  }, [locationName]);

  if (loading) return <div className="live-aqi-container loading">Loading Live AQI...</div>;
  if (error) return <div className="live-aqi-container error">Live AQI Error: {error}</div>;
  if (!liveData) return null;

  const aqi = Number(liveData.aqi);
  const category = getAqiCategory(aqi);

  return (
    <div className="live-aqi-container" style={{ borderLeft: `5px solid ${category.color}` }}>
      <div className="live-aqi-header">
        <h3>Live AQI ({locationName})</h3>
        <span className="live-pulse" title="Live Update"></span>
      </div>
      <div className="live-aqi-content">
        <div className="live-aqi-value" style={{ color: category.color }}>
          {aqi}
        </div>
        <div className="live-aqi-details">
          <div className="live-aqi-label" style={{ backgroundColor: category.bg, color: category.color }}>
            {category.label}
          </div>
          <div className="live-aqi-time">
            Updated: {new Date(liveData.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="live-aqi-station">
            Source: Open-Meteo
          </div>
        </div>
      </div>
    </div>
  );
}
