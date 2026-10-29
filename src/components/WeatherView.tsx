import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, parseISO, isSameDay, isToday } from 'date-fns';
import { RefreshCw, Droplets, Wind, Thermometer, Gauge, Sunrise, Sunset, ArrowUp, ArrowDown } from 'lucide-react';
import { weatherIcon, conditionLabel } from '../types/weather-icons';
import { haFetch, callHaService, hasToken } from '../api/ha-rest';
import { getConfig } from '../config';
import { useTranslation } from '../i18n';

interface ForecastItem {
  datetime: string;
  condition: string;
  temperature: number;
  templow: number;
  humidity?: number;
  wind_speed?: number;
  precipitation_probability?: number;
  precipitation?: number;
}

interface HourlyItem {
  datetime: string;
  condition: string;
  temperature: number;
  humidity?: number;
  wind_speed?: number;
  precipitation_probability?: number;
}

interface CurrentWeather {
  entityId: string;
  state: string;
  temperature: number;
  temperatureUnit: string;
  humidity?: number;
  windSpeed?: number;
  windSpeedUnit: string;
  windBearing?: number;
  pressure?: number;
  pressureUnit: string;
  feelsLike?: number;
}

interface SunTimes {
  rising: string;
  setting: string;
}

/** Hours of hourly forecast shown in the always-visible "today" strip. */
const TODAY_HOURS = 24;

function compassPoint(bearing: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

function formatPressure(value: number, unit: string): string {
  // inHg reads as 30.28; hPa/mbar as whole numbers
  const decimals = /inhg/i.test(unit) ? 2 : 0;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function WeatherView() {
  const { t, dateLocale } = useTranslation();
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<ForecastItem[]>([]);
  const [hourly, setHourly] = useState<HourlyItem[]>([]);
  const [sun, setSun] = useState<SunTimes | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hourlyLoading, setHourlyLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHourly = useCallback(async (entityId: string) => {
    try {
      setHourlyLoading(true);
      const result = await callHaService('weather', 'get_forecasts', {
        entity_id: entityId,
        type: 'hourly',
      }, true) as { service_response?: Record<string, { forecast: HourlyItem[] }> };

      const svcResponse = result?.service_response ?? result;
      const hourlyData = (svcResponse as Record<string, { forecast: HourlyItem[] }>)?.[entityId]?.forecast ?? [];
      setHourly(hourlyData);
    } catch {
      setHourly([]);
    } finally {
      setHourlyLoading(false);
    }
  }, []);

  const fetchSun = useCallback(async () => {
    try {
      const entity = await haFetch('/api/states/sun.sun') as { attributes: Record<string, unknown> } | null;
      const rising = entity?.attributes.next_rising as string | undefined;
      const setting = entity?.attributes.next_setting as string | undefined;
      setSun(rising && setting ? { rising, setting } : null);
    } catch {
      setSun(null);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!hasToken()) {
      setError(t('weatherView.notConnected'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Discover weather entity — try configured, then auto-discover
      const configEntity = getConfig().weather_entity;
      let entity: { entity_id: string; state: string; attributes: Record<string, unknown> } | null = null;

      // Try configured entity first
      if (configEntity) {
        try {
          entity = await haFetch(`/api/states/${configEntity}`) as typeof entity;
        } catch { /* entity doesn't exist, fall through to discovery */ }
      }

      // Auto-discover if configured entity doesn't exist
      if (!entity) {
        const states = await haFetch('/api/states') as Array<{
          entity_id: string;
          state: string;
          attributes: Record<string, unknown>;
        }>;
        const found = states.find(s => s.entity_id.startsWith('weather.'));
        if (!found) {
          setError(t('weatherView.noEntityFound'));
          setLoading(false);
          return;
        }
        entity = found;
      }

      const entityId = entity!.entity_id;

      const attrs = entity.attributes;
      setCurrent({
        entityId,
        state: entity.state,
        temperature: (attrs.temperature as number) ?? 0,
        temperatureUnit: (attrs.temperature_unit as string) ?? '°F',
        humidity: attrs.humidity as number | undefined,
        windSpeed: attrs.wind_speed as number | undefined,
        windSpeedUnit: (attrs.wind_speed_unit as string) ?? 'mph',
        windBearing: typeof attrs.wind_bearing === 'number' ? attrs.wind_bearing : undefined,
        pressure: attrs.pressure as number | undefined,
        pressureUnit: (attrs.pressure_unit as string) ?? 'hPa',
        feelsLike: attrs.apparent_temperature as number | undefined,
      });

      // Fetch daily forecast
      try {
        const result = await callHaService('weather', 'get_forecasts', {
          entity_id: entityId,
          type: 'daily',
        }, true) as { service_response?: Record<string, { forecast: ForecastItem[] }> };

        const svcResponse = result?.service_response ?? result;
        const forecastData = (svcResponse as Record<string, { forecast: ForecastItem[] }>)?.[entityId]?.forecast ?? [];
        setForecast(forecastData.slice(0, 7));
      } catch {
        // Forecast not available for this entity
        setForecast([]);
      }

      // Hourly forecast + sunrise/sunset (one cheap state read)
      await Promise.all([fetchHourly(entityId), fetchSun()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('weatherView.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [fetchHourly, fetchSun, t]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleDayClick = (datetime: string) => {
    setSelectedDay(prev => prev === datetime ? null : datetime);
  };

  // Always-visible strip: the next 24 hours from now
  const upcomingHours = useMemo(() => {
    const now = Date.now() - 60 * 60 * 1000; // keep the hour we are in
    return hourly.filter(h => parseISO(h.datetime).getTime() >= now).slice(0, TODAY_HOURS);
  }, [hourly]);

  const hoursForSelectedDay = selectedDay
    ? hourly.filter(h => isSameDay(parseISO(h.datetime), parseISO(selectedDay)))
    : [];

  const todayForecast = forecast.find(d => isToday(parseISO(d.datetime))) ?? forecast[0];

  if (loading && !current) {
    return (
      <div className="weather-view">
        <div className="weather-loading">{t('weatherView.loading')}</div>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="weather-view">
        <div className="weather-error">
          <p>{error}</p>
          <button type="button" className="weather-retry-btn" onClick={fetchData}>
            {t('weatherView.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const unit = current.temperatureUnit.replace('°', '');
  const timeFmt = 'h:mm a';

  const details: Array<{ key: string; icon: React.ReactNode; label: string; value: string }> = [];
  if (current.feelsLike != null) {
    details.push({ key: 'feels', icon: <Thermometer size={22} strokeWidth={1.5} />, label: t('weatherView.feelsLike'), value: `${Math.round(current.feelsLike)}°${unit}` });
  }
  if (current.humidity != null) {
    details.push({ key: 'humidity', icon: <Droplets size={22} strokeWidth={1.5} />, label: t('weatherView.humidity'), value: `${Math.round(current.humidity)}%` });
  }
  if (current.windSpeed != null) {
    const dir = current.windBearing != null ? ` ${compassPoint(current.windBearing)}` : '';
    details.push({ key: 'wind', icon: <Wind size={22} strokeWidth={1.5} />, label: t('weatherView.wind'), value: `${Math.round(current.windSpeed)} ${current.windSpeedUnit}${dir}` });
  }
  if (current.pressure != null) {
    details.push({ key: 'pressure', icon: <Gauge size={22} strokeWidth={1.5} />, label: t('weatherView.pressure'), value: formatPressure(current.pressure, current.pressureUnit) });
  }
  if (sun) {
    details.push({ key: 'sunrise', icon: <Sunrise size={22} strokeWidth={1.5} />, label: t('weatherView.sunrise'), value: format(parseISO(sun.rising), timeFmt, { locale: dateLocale }) });
    details.push({ key: 'sunset', icon: <Sunset size={22} strokeWidth={1.5} />, label: t('weatherView.sunset'), value: format(parseISO(sun.setting), timeFmt, { locale: dateLocale }) });
  }

  return (
    <div className="weather-view weather-view--panel">
      {/* Current conditions + details */}
      <section className="weather-current weather-current--panel">
        <div className="weather-current-main">
          <span className="weather-current-icon">
            {weatherIcon(current.state)}
          </span>
          <div className="weather-current-temp-block">
            <span className="weather-current-temp">
              {Math.round(current.temperature)}°{unit}
            </span>
            <span className="weather-current-condition">
              {conditionLabel(current.state, t)}
            </span>
            {todayForecast && (
              <span className="weather-current-range">
                <ArrowUp size={16} strokeWidth={2} /> {Math.round(todayForecast.temperature)}°
                <span className="weather-current-range-sep" />
                <ArrowDown size={16} strokeWidth={2} /> {Math.round(todayForecast.templow)}°
                {todayForecast.precipitation_probability != null && (
                  <>
                    <span className="weather-current-range-sep" />
                    <Droplets size={16} strokeWidth={2} /> {todayForecast.precipitation_probability}%
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {details.length > 0 && (
          <div className="weather-details-grid">
            {details.map((d) => (
              <div key={d.key} className="weather-detail weather-detail--tile">
                <span className="weather-detail-icon">{d.icon}</span>
                <span className="weather-detail-label">{d.label}</span>
                <span className="weather-detail-value">{d.value}</span>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          className="weather-refresh-btn"
          onClick={fetchData}
          title={t('weatherView.refreshWeather')}
          aria-label={t('weatherView.refreshWeather')}
        >
          <RefreshCw size={18} strokeWidth={1.5} />
        </button>
      </section>

      {/* Next 24 hours — always visible */}
      <section className="weather-forecast">
        <h2 className="weather-forecast-title">{t('weatherView.next24Hours')}</h2>
        {hourlyLoading && upcomingHours.length === 0 ? (
          <div className="weather-hourly-loading">{t('weatherView.loadingHourly')}</div>
        ) : upcomingHours.length === 0 ? (
          <div className="weather-hourly-empty">{t('weatherView.noHourlyData')}</div>
        ) : (
          <div className="weather-hourly-scroll weather-hourly-scroll--today">
            {upcomingHours.map((hour, i) => {
              const time = parseISO(hour.datetime);
              return (
                <div key={hour.datetime} className="weather-hourly-card weather-hourly-card--lg">
                  <span className="weather-hourly-time">{i === 0 ? t('weatherView.now') : format(time, 'h a', { locale: dateLocale })}</span>
                  <span className="weather-hourly-icon">{weatherIcon(hour.condition)}</span>
                  <span className="weather-hourly-temp">{Math.round(hour.temperature)}°</span>
                  <span className={`weather-hourly-precip${(hour.precipitation_probability ?? 0) === 0 ? ' weather-hourly-precip--none' : ''}`}>
                    <Droplets size={13} /> {hour.precipitation_probability ?? 0}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 7-day forecast */}
      {forecast.length > 0 && (
        <section className="weather-forecast">
          <h2 className="weather-forecast-title">{t('weatherView.sevenDayForecast')}</h2>
          <div className="weather-forecast-grid">
            {forecast.map((day) => {
              const date = parseISO(day.datetime);
              const today = isToday(date);
              const dayName = today ? t('common.today') : format(date, 'EEEE', { locale: dateLocale });
              const dateLabel = format(date, 'MMM d', { locale: dateLocale });
              const isSelected = selectedDay === day.datetime;
              return (
                <button
                  key={day.datetime}
                  type="button"
                  className={`weather-forecast-card weather-forecast-card--lg${isSelected ? ' weather-forecast-card--selected' : ''}${today ? ' weather-forecast-card--today' : ''}`}
                  onClick={() => handleDayClick(day.datetime)}
                  aria-expanded={isSelected}
                >
                  <span className="weather-forecast-day">{dayName}</span>
                  <span className="weather-forecast-date">{dateLabel}</span>
                  <span className="weather-forecast-icon">
                    {weatherIcon(day.condition)}
                  </span>
                  <span className="weather-forecast-cond">{conditionLabel(day.condition, t)}</span>
                  <div className="weather-forecast-temps">
                    <span className="weather-forecast-high">{Math.round(day.temperature)}°</span>
                    <span className="weather-forecast-low">{Math.round(day.templow)}°</span>
                  </div>
                  <span className={`weather-forecast-precip${(day.precipitation_probability ?? 0) === 0 ? ' weather-forecast-precip--none' : ''}`}>
                    <Droplets size={14} /> {day.precipitation_probability ?? 0}%
                  </span>
                </button>
              );
            })}
          </div>

          {/* Hourly detail for a tapped day */}
          {selectedDay && (
            <div className="weather-hourly">
              <div className="weather-hourly-header">
                <h3 className="weather-hourly-title">
                  {t('weatherView.hourlyForDay', { day: format(parseISO(selectedDay), 'EEEE, MMM d', { locale: dateLocale }) })}
                </h3>
                <button
                  type="button"
                  className="weather-hourly-close"
                  onClick={() => setSelectedDay(null)}
                  aria-label={t('weatherView.closeHourlyForecastAria')}
                >
                  {t('weatherView.collapse')}
                </button>
              </div>
              {hourlyLoading ? (
                <div className="weather-hourly-loading">{t('weatherView.loadingHourly')}</div>
              ) : hoursForSelectedDay.length === 0 ? (
                <div className="weather-hourly-empty">{t('weatherView.noHourlyData')}</div>
              ) : (
                <div className="weather-hourly-scroll">
                  {hoursForSelectedDay.map((hour) => {
                    const time = parseISO(hour.datetime);
                    return (
                      <div key={hour.datetime} className="weather-hourly-card">
                        <span className="weather-hourly-time">{format(time, 'h a', { locale: dateLocale })}</span>
                        <span className="weather-hourly-icon">{weatherIcon(hour.condition)}</span>
                        <span className="weather-hourly-temp">{Math.round(hour.temperature)}°</span>
                        {hour.precipitation_probability != null && (
                          <span className="weather-hourly-precip">
                            <Droplets size={12} /> {hour.precipitation_probability}%
                          </span>
                        )}
                        {hour.wind_speed != null && (
                          <span className="weather-hourly-wind">
                            <Wind size={12} /> {Math.round(hour.wind_speed)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
