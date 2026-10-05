const { getFirestore } = require("firebase-admin/firestore");
async function getWeather() {
  const db = getFirestore(),
    r = db.doc("internal/weatherCache");
  const cache = (await r.get()).data();
  const now = Date.now();
  if (cache && Object.hasOwn(cache.forecast?.current || {}, "apparent_temperature") && now - cache.fetchedAt < 15 * 60000)
    return { ...cache, status: "ok" };
  const params =
    "latitude=37.617954&longitude=127.057038&timezone=Asia%2FSeoul&forecast_days=2";
  try {
    const urls = [
      `https://api.open-meteo.com/v1/forecast?${params}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&wind_speed_unit=ms`,
      `https://air-quality-api.open-meteo.com/v1/air-quality?${params}&current=pm10,pm2_5&hourly=pm10,pm2_5`,
    ];
    const [forecast, air] = await Promise.all(
      urls.map(async (u) => {
        const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw Error("WEATHER_PROVIDER_UNAVAILABLE");
        const data = await res.json();
        if (data.error) throw Error("WEATHER_PROVIDER_UNAVAILABLE");
        return data;
      }),
    );
    const data = {
      forecast,
      air,
      fetchedAt: now,
      source: "Open-Meteo",
      isModelEstimate: true,
    };
    await r.set(data);
    return { ...data, status: "ok" };
  } catch {
    return cache
      ? { ...cache, status: "stale" }
      : {
          status: "error",
          forecast: null,
          air: null,
          source: "Open-Meteo",
          isModelEstimate: true,
        };
  }
}
module.exports = { getWeather };
