// Direcciones y tiempos de viaje.
// Con clave de TomTom: búsqueda de direcciones y negocios + tiempos con tráfico (previsto o en vivo).
// Sin clave: Nominatim/Photon (OpenStreetMap) + OSRM, con un factor de tráfico por franja horaria.

const BCN = { lat: 41.372, lon: 2.077 };

export function haversineKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Coordenadas pegadas a mano o dentro de un enlace de Google Maps.
export function coordsFromText(text) {
  const s = String(text || '');
  const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    s.match(/[?&](?:q|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})\s*$/);
  return m ? { lat: +m[1], lon: +m[2] } : null;
}

// ---------- Búsqueda de direcciones ----------

let lastNominatim = 0;
async function politeNominatim(url) {
  const wait = lastNominatim + 1100 - Date.now(); // máx. 1 petición/s según su política de uso
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

export async function geocode(query, { key, near = BCN } = {}) {
  const q = query.trim();
  if (!q) return [];
  const direct = coordsFromText(q);
  if (direct) return [{ ...direct, label: `${direct.lat.toFixed(5)}, ${direct.lon.toFixed(5)}`, source: 'coords' }];

  if (key) {
    const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}` +
      `&countrySet=ES&language=es-ES&limit=5&lat=${near.lat}&lon=${near.lon}&radius=80000`;
    const res = await fetch(url);
    if (res.status === 403 || res.status === 401) throw new Error('La clave de TomTom no es válida');
    if (!res.ok) throw new Error(`TomTom ${res.status}`);
    const data = await res.json();
    return (data.results || []).map((r) => ({
      lat: r.position.lat,
      lon: r.position.lon,
      label: [r.poi?.name, r.address?.freeformAddress].filter(Boolean).join(' · '),
      source: 'tomtom',
    }));
  }

  const nom = await politeNominatim(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=es&viewbox=1.55,41.75,2.6,41.1&q=${encodeURIComponent(q)}`,
  ).catch(() => []);
  let out = nom.map((r) => ({ lat: +r.lat, lon: +r.lon, label: r.display_name.split(', ').slice(0, 4).join(', '), source: 'osm' }));
  if (out.length === 0) {
    const res = await fetch(`https://photon.komoot.io/api/?limit=5&lat=${near.lat}&lon=${near.lon}&q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      out = (data.features || []).filter((f) => f.properties.countrycode === 'ES').map((f) => {
        const p = f.properties;
        const street = [p.street, p.housenumber].filter(Boolean).join(' ');
        return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: [p.name, street, p.city].filter(Boolean).join(', '), source: 'osm' };
      });
    }
  }
  // Primero lo más cercano al almacén: en el área de reparto, no en otra provincia con el mismo nombre de calle.
  return out.sort((a, b) => haversineKm(near, a) - haversineKm(near, b));
}

// ---------- Matriz de tiempos ----------

// Sin tráfico real, OSRM da tiempos de carretera vacía. Corrección orientativa para el área de Barcelona.
export function trafficFactor(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  if (weekend) return 1.1;
  if (h >= 7 && h < 9.75) return 1.45;
  if (h >= 9.75 && h < 13) return 1.2;
  if (h >= 13 && h < 16) return 1.15;
  if (h >= 16 && h < 20) return 1.4;
  return 1.1;
}

function localIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Devuelve { minutes[o][d], km[o][d], source, live }.
export async function travelMatrix(origins, destinations, { key, departAt, live } = {}) {
  const depart = departAt instanceof Date ? departAt : new Date();
  if (key) return tomtomMatrix(origins, destinations, key, depart, live);
  return osrmMatrix(origins, destinations, depart);
}

async function osrmMatrix(origins, destinations, depart) {
  const pts = [...origins, ...destinations];
  const coords = pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const src = origins.map((_, i) => i).join(';');
  const dst = destinations.map((_, i) => i + origins.length).join(';');
  const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM: ${data.message || data.code}`);
  const f = trafficFactor(depart);
  return {
    minutes: data.durations.map((row, i) => row.map((s, j) => (s == null ? estimate(origins[i], destinations[j]) : (s / 60) * f))),
    km: data.distances.map((row) => row.map((m) => (m == null ? null : m / 1000))),
    source: 'osrm',
    live: false,
  };
}

// Si una celda falla, una estimación prudente: 1,4× la línea recta a 25 km/h + 3 min de aparcar.
function estimate(a, b) {
  return (haversineKm(a, b) * 1.4 / 25) * 60 + 3;
}

// La API síncrona de TomTom admite como máximo 100 celdas por petición: se trocea en bloques de 10×10.
async function tomtomMatrix(origins, destinations, key, depart, live) {
  const minutes = origins.map(() => destinations.map(() => null));
  const km = origins.map(() => destinations.map(() => null));
  const tiles = [];
  for (let o = 0; o < origins.length; o += 10) {
    for (let d = 0; d < destinations.length; d += 10) tiles.push([o, d]);
  }
  const options = live
    ? { departAt: 'now', traffic: 'live', routeType: 'fastest', travelMode: 'car' }
    : { departAt: depart > new Date() ? localIso(depart) : 'now', traffic: 'historical', routeType: 'fastest', travelMode: 'car' };

  const run = async ([o0, d0]) => {
    const os = origins.slice(o0, o0 + 10), ds = destinations.slice(d0, d0 + 10);
    const body = {
      origins: os.map((p) => ({ point: { latitude: p.lat, longitude: p.lon } })),
      destinations: ds.map((p) => ({ point: { latitude: p.lat, longitude: p.lon } })),
      options,
    };
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`https://api.tomtom.com/routing/matrix/2?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status !== 429 && res.status !== 408 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    if (res.status === 403 || res.status === 401) throw new Error('La clave de TomTom no es válida');
    if (!res.ok) throw new Error(`TomTom ${res.status}`);
    const data = await res.json();
    for (const cell of data.data || []) {
      const i = o0 + cell.originIndex, j = d0 + cell.destinationIndex;
      if (cell.routeSummary) {
        minutes[i][j] = cell.routeSummary.travelTimeInSeconds / 60;
        km[i][j] = cell.routeSummary.lengthInMeters / 1000;
      }
    }
  };

  // Dos peticiones a la vez para no chocar con el límite de frecuencia.
  const queue = tiles.slice();
  await Promise.all([0, 1].map(async () => { while (queue.length) await run(queue.shift()); }));

  for (let i = 0; i < origins.length; i++) {
    for (let j = 0; j < destinations.length; j++) {
      if (minutes[i][j] == null) minutes[i][j] = sameSpot(origins[i], destinations[j]) ? 0 : estimate(origins[i], destinations[j]);
    }
  }
  return { minutes, km, source: 'tomtom', live: !!live };
}

function sameSpot(a, b) {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
}

// ---------- Navegación ----------

export function navUrl(app, p) {
  if (app === 'gmaps') return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=driving`;
  return `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`;
}

export function currentPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}
