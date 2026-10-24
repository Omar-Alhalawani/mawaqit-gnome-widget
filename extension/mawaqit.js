// Pure data parser, intentionally independent of GNOME Shell.
// Mawaqit publishes calendar and iqamaCalendar separately in confData.
export const MOSQUES = [
  {name: 'MAC Barrhaven Islamic Centre', short: 'MAC Barrhaven', slug: 'm/mac-barrhaven-islamic-centre-ottawa-k2c-3h2-canada'},
  {name: 'South Nepean Muslim Community', short: 'SNMC', slug: 'south-nepean-muslim-community-snmc-ottawa-k2j-4g3-canada'},
  {name: 'Qurtoba Islamic Center', short: 'Qurtoba Islamic Center', slug: 'm/qic-mousque-ottawa-k2g-5t5-canada'},
];
export const NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export function extractConfData(html) {
  const marker = /\bconfData\s*=\s*\{/g;
  let match;
  while ((match = marker.exec(html)) !== null) {
    const begin = match.index + match[0].length - 1;
    let depth = 0, escaped = false, quoted = false;
    for (let p = begin; p < html.length; p++) {
      const ch = html[p];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}' && --depth === 0) {
        const value = JSON.parse(html.slice(begin, p + 1));
        if (!Array.isArray(value.calendar) || value.calendar.length !== 12)
          throw new Error('Mawaqit calendar is missing or incomplete');
        return value;
      }
    }
  }
  throw new Error('Mawaqit confData not found in the mosque webpage');
}

function validTime(t) {
  if (typeof t !== 'string' || !/^\d{1,2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h < 24 && m < 60;
}

export function prayerRow(row, sunriseFallback = '') {
  if (!Array.isArray(row)) throw new Error('No Mawaqit prayer row');
  let p, sunrise;
  if (row.length === 7) {
    // Some Turkish mosques include Imsak AND Sabah, then sunrise.
    p = [row[0], row[3], row[4], row[5], row[6]];
    sunrise = row[2];
  } else if (row.length === 6) {
    p = [row[0], row[2], row[3], row[4], row[5]];
    sunrise = row[1];
  } else if (row.length === 5) {
    p = [...row];
    sunrise = sunriseFallback;
  } else {
    throw new Error(`Unexpected Mawaqit prayer row length: ${row.length}`);
  }
  if (!p.every(validTime)) throw new Error('Invalid published prayer time');
  return {times: p, sunrise: validTime(sunrise) ? sunrise : ''};
}

function calendarRow(calendar, month, day) {
  if (!Array.isArray(calendar)) return null;
  const monthData = calendar[month - 1];
  return monthData && typeof monthData === 'object' ? (monthData[String(day)] ?? null) : null;
}

// Fetched today: confData.times is the mosque's authoritative current daily row.
// For other dates use the yearly calendar. We never substitute a guessed Isha.
export function dayData(conf, year, month, day, useLiveToday = false) {
  const source = useLiveToday && Array.isArray(conf.times) && conf.times.length >= 5
    ? conf.times
    : calendarRow(conf.calendar, month, day);
  const {times, sunrise} = prayerRow(source, conf.shuruq || '');
  const iqRow = calendarRow(conf.iqamaCalendar, month, day);
  const iqamah = NAMES.map((_, i) => {
    const raw = Array.isArray(iqRow) ? iqRow[i] : null;
    // Accept only mosque-published offsets or clock times; NEVER invent +10.
    if (typeof raw !== 'string') return '—';
    const str = raw.trim();
    if (validTime(str)) return formatTime(str);
    if (/^\+\d{1,3}$/.test(str)) return str;
    return '—';
  });
  return {times, iqamah, sunrise, year, month, day};
}

export function formatTime(t) {
  if (!validTime(t)) return '—';
  const [h, min] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(min).padStart(2, '0')}`;
}

export function parseClock(t) {
  if (!validTime(t)) throw new Error('Invalid Mawaqit time');
  return t.split(':').map(Number);
}
