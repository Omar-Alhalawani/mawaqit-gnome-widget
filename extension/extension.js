import St from 'gi://St';
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {MOSQUES, NAMES, extractConfData, dayData, formatTime, parseClock} from './mawaqit.js';

const WIDTH = 540;
const HEIGHT = 208;
const REFRESH_INTERVAL_SECONDS = 3 * 3600;
const STATE_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'omar-mawaqit-desktop.json']);
const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'omar-mawaqit-gnome']);

function label(text = '', styleClass = '', expand = false) {
  return new St.Label({text, style_class: styleClass, x_expand: expand, y_align: Clutter.ActorAlign.CENTER});
}
function getJSON(path) {
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    return ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  } catch { return null; }
}
function putJSON(path, value) {
  try {
    GLib.file_set_contents(path, JSON.stringify(value));
  } catch (e) { console.warn(`Mawaqit desktop: could not save ${path}: ${e.message}`); }
}
function localDay(tz) {
  const d = GLib.DateTime.new_now(tz);
  return [d.get_year(), d.get_month(), d.get_day_of_month()];
}
function localDayKey(tz) { return localDay(tz).join('-'); }
function todayAt(tz, d, t) {
  const [hh, mm] = parseClock(t);
  return GLib.DateTime.new(tz, d[0], d[1], d[2], hh, mm, 0).to_unix();
}
function padded(v) { return String(v).padStart(2, '0'); }

// GDM Remote Login can enable extensions before the virtual monitor is
// registered. Never assume layoutManager.primaryMonitor is already present.
// Prefer a real monitor; otherwise use a safe stage-sized rectangle until
// GNOME sends monitors-changed. This must also work during disconnects.
function availableMonitor() {
  const lm = Main.layoutManager;
  const real = lm.primaryMonitor ?? lm.monitors?.[0] ?? null;
  if (real && Number.isFinite(real.width) && real.width > 0 &&
      Number.isFinite(real.height) && real.height > 0)
    return {x: real.x ?? 0, y: real.y ?? 0, width: real.width, height: real.height, fallback: false};
  try {
    if (global.display.get_n_monitors() > 0) {
      const geo = global.display.get_monitor_geometry(0);
      if (geo && geo.width > 0 && geo.height > 0)
        return {x: geo.x, y: geo.y, width: geo.width,
          height: geo.height, fallback: false};
    }
  } catch (e) {
    // A remote login can temporarily have no monitor at all.
  }
  const w = Math.max(WIDTH + 40, global.stage?.width || 1280);
  const h = Math.max(HEIGHT + 80, global.stage?.height || 720);
  return {x: 0, y: 0, width: w, height: h, fallback: true};
}


// Native Cairo background: unlike GNOME Shell CSS, this paints the pattern
// directly to a St.DrawingArea and doesn't rely on unsupported background-image.
function roundedRectangle(cr, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  cr.newSubPath();
  cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
  cr.closePath();
}
function eightPointStar(cr, cx, cy, outer, inner, angle = 0) {
  for (let i = 0; i < 16; i++) {
    const theta = angle + i * Math.PI / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + r * Math.cos(theta), y = cy + r * Math.sin(theta);
    if (i === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
  }
  cr.closePath();
}
function paintOrnaments(area) {
  const cr = area.get_context();
  try {
    const [w, h] = area.get_surface_size();
    if (w < 2 || h < 2) return;
    cr.save();
    roundedRectangle(cr, 0.5, 0.5, w - 1, h - 1, 22);
    cr.clip();

    // Violet fabric lighting: luminous corner, velvety centre, deep right edge.
    const ground = new Cairo.LinearGradient(0, 0, w, h);
    ground.addColorStopRGBA(0, 0.57, 0.16, 0.92, 1);
    ground.addColorStopRGBA(0.46, 0.47, 0.12, 0.84, 1);
    ground.addColorStopRGBA(1, 0.36, 0.08, 0.70, 1);
    cr.setSource(ground); cr.paint();

    // Asymmetric, low-contrast geometric rosettes at the edges.
    // No tiled star outlines underneath the prayer numbers.
    for (const [x, y, radius, alpha] of [
      [506, -8, 108, 0.115], [546, 140, 75, 0.085],
      [5, 208, 96, 0.10], [-45, 80, 66, 0.055],
    ]) {
      cr.setLineWidth(1.25);
      for (let ring = 0; ring < 3; ring++) {
        const r = radius * (1 - ring * 0.22);
        cr.setSourceRGBA(1, 0.85, 1, alpha * (1 - ring * 0.21));
        eightPointStar(cr, x, y, r, r * 0.56, ring * Math.PI / 8);
        cr.stroke();
        cr.arc(x, y, r * 0.82, 0, Math.PI * 2);
        cr.stroke();
      }
    }
    // Silk-like, curved bands along the bottom edge.
    cr.setLineWidth(24);
    cr.setSourceRGBA(1, 0.82, 1, 0.045);
    cr.moveTo(-35, 192);
    cr.curveTo(120, 155, 130, 233, 290, 186);
    cr.curveTo(408, 151, 460, 217, 575, 159);
    cr.stroke();
    cr.setLineWidth(1.1);
    cr.setSourceRGBA(1, 0.9, 1, 0.11);
    roundedRectangle(cr, 1, 1, w - 2, h - 2, 21);
    cr.stroke();
    cr.restore();
  } finally {
    cr.$dispose();
  }
}

export default class OmarPrayerDesktopExtension extends Extension {
  enable() {
    this._destroyed = false;
    this._state = {index: 0, x: null, y: null, ...getJSON(STATE_FILE)};
    this._state.index = Number.isInteger(this._state.index)
      ? ((this._state.index % 3) + 3) % 3 : 0;
    this._cached = new Map();
    this._session = new Soup.Session({timeout: 20});
    this._activeRequest = null;
    GLib.mkdir_with_parents(CACHE_DIR, 0o700);
    this._createUI();
    // Add to GNOME's wallpaper/background layer, not as an application window.
    const bg = Main.layoutManager._backgroundGroup;
    if (!bg) throw new Error('GNOME desktop background group is unavailable');
    bg.add_child(this._canvas);
    this._placeInitial();
    this._monitorID = Main.layoutManager.connect('monitors-changed', () => this._placeInitial());
    this._showFromCache();
    this._fetch(true);
    this._tickID = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
      if (this._destroyed) return GLib.SOURCE_REMOVE;
      // Remote sessions can acquire a monitor after extension startup
      // without a monitors-changed signal. Reposition once when that happens.
      if (this._usingFallbackMonitor && !availableMonitor().fallback)
        this._placeInitial();
      this._updateTime();
      return GLib.SOURCE_CONTINUE;
    });
    this._syncID = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 180, () => {
      if (this._destroyed) return GLib.SOURCE_REMOVE;
      this._fetch(false);
      return GLib.SOURCE_CONTINUE;
    });
  }

  disable() {
    this._destroyed = true;
    if (this._tickID) { GLib.Source.remove(this._tickID); this._tickID = null; }
    if (this._syncID) { GLib.Source.remove(this._syncID); this._syncID = null; }
    if (this._monitorID) { Main.layoutManager.disconnect(this._monitorID); this._monitorID = null; }
    this._stopDrag(false);
    this._activeRequest?.cancel();
    this._activeRequest = null;
    this._session?.abort();
    this._session = null;
    this._canvas?.destroy();
    this._canvas = null;
    this._card = null;
    this._body = null;
    this._ornament = null;
    this._cached?.clear();
    this._cached = null;
  }

  _createUI() {
    const mon = availableMonitor();
    this._canvas = new St.Widget({
      reactive: false, x: 0, y: 0,
      width: Math.max(global.stage?.width || 0, mon.x + mon.width),
      height: Math.max(global.stage?.height || 0, mon.y + mon.height),
      style: 'background-color: rgba(0,0,0,0.001);',
    });
    // A native desktop-layer actor, not an application window.
    this._card = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      reactive: true, track_hover: true, clip_to_allocation: true,
    });
    this._card.set_size(WIDTH, HEIGHT);
    this._canvas.add_child(this._card);
    this._ornament = new St.DrawingArea({width: WIDTH, height: HEIGHT, reactive: false});
    this._ornament.connect('repaint', paintOrnaments);
    this._card.add_child(this._ornament);
    this._body = new St.Widget({
      layout_manager: new Clutter.FixedLayout(),
      style_class: 'omar-mawaqit-desktop-body',
      width: WIDTH, height: HEIGHT,
    });
    this._card.add_child(this._body);

    const at = (actor, x, y, width, height) => {
      this._body.add_child(actor);
      actor.set_position(x, y);
      actor.set_size(width, height);
      return actor;
    };
    const txt = (initial, css, x, y, width, height = 24) =>
      at(label(initial, css), x, y, width, height);

    const grip = new St.Button({
      child: label('◈', 'omar-mawaqit-mark'),
      can_focus: true, style: 'background: transparent; border: none; padding: 0;',
    });
    grip.connect('button-press-event', (_actor, event) => this._startDrag(event));
    at(grip, 17, 15, 40, 40);
    this._name = txt('', 'omar-mawaqit-mosque', 68, 12, 227, 31);
    this._place = txt('Ottawa · Ontario', 'omar-mawaqit-place', 68, 40, 226, 22);

    this._prev = at(new St.Button({label: '‹', style_class: 'omar-mawaqit-nav'}), 309, 18, 24, 40);
    this._next = at(new St.Button({label: '›', style_class: 'omar-mawaqit-nav'}), 337, 18, 24, 40);
    this._prev.connect('clicked', () => this._switchMosque(-1));
    this._next.connect('clicked', () => this._switchMosque(1));
    this._countPrefix = txt('Next prayer', 'omar-mawaqit-count-prefix', 389, 14, 139, 18);
    this._count = txt('--:--:--', 'omar-mawaqit-count', 385, 32, 147, 39);

    this._sunrise = txt('☀  —', 'omar-mawaqit-pill', 18, 73, 242, 27);
    this._date = txt('—', 'omar-mawaqit-pill', 278, 73, 244, 27);

    this._prayers = [];
    NAMES.forEach((name, i) => {
      const x = 18 + i * 102;
      const n = txt(name, 'omar-mawaqit-prayer-name', x, 114, 98, 22);
      const t = txt('—:—', 'omar-mawaqit-prayer-clock', x, 134, 98, 33);
      const iq = txt('—', 'omar-mawaqit-prayer-iqama', x, 165, 98, 22);
      const under = at(new St.Widget({style_class: 'omar-mawaqit-clear-underline'}), x, 191, 96, 3);
      this._prayers.push({n, t, iq, under});
    });
    this._status = txt('', 'omar-mawaqit-status', 18, 195, 500, 12);
    this._status.visible = false;
    this._card.connect('button-press-event', (_actor, event) => {
      if (event.get_button() === 1 && (event.get_state() & Clutter.ModifierType.MOD1_MASK))
        return this._startDrag(event);
      return Clutter.EVENT_PROPAGATE;
    });
  }

  _placeInitial() {
    if (!this._canvas || !this._card) return;
    const mon = availableMonitor();
    this._usingFallbackMonitor = mon.fallback;
    this._canvas.set_size(
      Math.max(global.stage?.width || 0, mon.x + mon.width),
      Math.max(global.stage?.height || 0, mon.y + mon.height));
    const x = Number.isFinite(this._state.x) ? this._state.x : mon.x + mon.width - WIDTH - 30;
    const y = Number.isFinite(this._state.y) ? this._state.y : mon.y + 65;
    this._card.set_position(
      Math.max(mon.x, Math.min(x, Math.max(mon.x, mon.x + mon.width - WIDTH))),
      Math.max(mon.y, Math.min(y, Math.max(mon.y, mon.y + mon.height - HEIGHT))));
  }

  _startDrag(event) {
    if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
    const [x, y] = event.get_coords();
    const [cardX, cardY] = this._card.get_position();
    this._dragging = {dx: x - cardX, dy: y - cardY};
    this._captureID = global.stage.connect('captured-event', (_stage, e) => {
      if (!this._dragging) return Clutter.EVENT_PROPAGATE;
      if (e.type() === Clutter.EventType.MOTION) {
        const [mx, my] = e.get_coords();
        const mon = availableMonitor();
        const nx = Math.max(mon.x, Math.min(Math.round(mx - this._dragging.dx), Math.max(mon.x, mon.x + mon.width - WIDTH)));
        const ny = Math.max(mon.y, Math.min(Math.round(my - this._dragging.dy), Math.max(mon.y, mon.y + mon.height - HEIGHT)));
        this._card.set_position(nx, ny);
        return Clutter.EVENT_STOP;
      }
      if (e.type() === Clutter.EventType.BUTTON_RELEASE && e.get_button() === 1) {
        this._stopDrag(true);
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    });
    return Clutter.EVENT_STOP;
  }

  _stopDrag(save) {
    if (this._captureID) { global.stage.disconnect(this._captureID); this._captureID = null; }
    if (this._dragging && save) {
      const [x, y] = this._card.get_position();
      this._state.x = Math.round(x);
      this._state.y = Math.round(y);
      putJSON(STATE_FILE, this._state);
    }
    this._dragging = null;
  }

  _switchMosque(delta) {
    this._state.index = (this._state.index + delta + MOSQUES.length) % MOSQUES.length;
    putJSON(STATE_FILE, this._state);
    this._showFromCache();
    this._fetch(true);
  }

  _readCache() {
    const index = this._state.index;
    const rec = this._cached.get(index);
    if (rec) return rec;
    const path = GLib.build_filenamev([CACHE_DIR, `${index}.json`]);
    const fromDisk = getJSON(path);
    if (fromDisk && typeof fromDisk === 'object' &&
        fromDisk.slug === MOSQUES[index].slug && fromDisk.conf?.calendar) {
      this._cached.set(index, fromDisk);
      return fromDisk;
    }
    return null;
  }

  _setStatus(message) {
    this._status.set_text(message);
    this._status.visible = Boolean(message);
  }

  _showFromCache() {
    this._name.set_text(MOSQUES[this._state.index].short);
    this._countPrefix.set_text('Next prayer');
    this._count.set_text('--:--:--');
    this._sunrise.set_text('☀  —');
    this._date.set_text('Ottawa · Ontario');
    this._prayers.forEach((w, i) => {
      w.n.set_style_class_name('omar-mawaqit-prayer-name');
      w.t.set_style_class_name('omar-mawaqit-prayer-clock');
      w.iq.set_style_class_name('omar-mawaqit-prayer-iqama');
      w.under.set_style_class_name('omar-mawaqit-clear-underline');
      w.t.set_text('—:—'); w.iq.set_text('—');
    });
    if (!this._readCache()) {
      this._setStatus('Loading live mosque schedule…');
    } else {
      this._setStatus('');
      this._updateTime();
    }
  }

  _fetch(force) {
    const index = this._state.index;
    const mosque = MOSQUES[index];
    const old = this._readCache();
    const age = old ? (GLib.get_real_time() / 1000000 - old.fetchedAt) : Infinity;
    if (!force && age < REFRESH_INTERVAL_SECONDS) return;
    if (this._activeRequest) {
      if (!force) return;
      // Switching mosques should fetch immediately, not wait for the old request.
      this._activeRequest.cancel();
      this._activeRequest = null;
    }
    const message = Soup.Message.new('GET', `https://mawaqit.net/en/${mosque.slug}`);
    if (!message) return;
    message.get_request_headers().append('User-Agent', 'Mozilla/5.0');
    const cancellable = new Gio.Cancellable();
    this._activeRequest = cancellable;
    this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, res) => {
      if (this._destroyed) return;
      if (this._activeRequest === cancellable) this._activeRequest = null;
      try {
        const bytes = session.send_and_read_finish(res);
        if (message.get_status() !== Soup.Status.OK)
          throw new Error(`Mawaqit returned HTTP ${message.get_status()}`);
        const raw = new TextDecoder().decode(bytes.get_data());
        if (raw.length > 12_000_000) throw new Error('Unexpectedly large response');
        const conf = extractConfData(raw);
        const zone = GLib.TimeZone.new_identifier(conf.timezone || 'America/Toronto');
        const entry = {slug: mosque.slug, fetchedAt: GLib.get_real_time() / 1000000,
          fetchedDay: localDayKey(zone), conf};
        this._cached.set(index, entry);
        putJSON(GLib.build_filenamev([CACHE_DIR, `${index}.json`]), entry);
        if (this._state.index === index) this._updateTime();
      } catch (e) {
        console.warn(`Mawaqit desktop: ${mosque.short}: ${e.message}`);
        if (this._state.index === index)
          this._setStatus(this._readCache() ? 'Offline · saved mosque times' : 'Could not load mosque data');
      }
    });
  }

  _updateTime() {
    if (!this._card) return;
    const entry = this._readCache();
    if (!entry) return;
    try {
      const tz = GLib.TimeZone.new_identifier(entry.conf.timezone || 'America/Toronto');
      const d = localDay(tz);
      const isTodayFetch = localDayKey(tz) === entry.fetchedDay;
      const today = dayData(entry.conf, ...d, isTodayFetch);
      const nowTs = GLib.DateTime.new_now(tz).to_unix();
      let nextIndex = today.times.findIndex(t => todayAt(tz, d, t) > nowTs);
      let nextAt = 0;
      let nextName = '';
      if (nextIndex >= 0) {
        nextName = NAMES[nextIndex];
        nextAt = todayAt(tz, d, today.times[nextIndex]);
      } else {
        // Crossing midnight: use tomorrow's published Fajr, not today's Fajr + 24h.
        const tomorrow = GLib.DateTime.new_now(tz).add_days(1);
        const td = [tomorrow.get_year(), tomorrow.get_month(), tomorrow.get_day_of_month()];
        const dayTomorrow = dayData(entry.conf, ...td, false);
        nextName = 'Fajr';
        nextAt = todayAt(tz, td, dayTomorrow.times[0]);
      }
      const left = Math.max(0, nextAt - nowTs);
      this._countPrefix.set_text(`${nextName}${nextIndex < 0 ? ' tomorrow' : ''} in`);
      this._count.set_text(`${Math.floor(left / 3600)}:${padded(Math.floor(left % 3600 / 60))}:${padded(left % 60)}`);
      const sunrise = today.sunrise ? formatTime(today.sunrise) : '—';
      this._sunrise.set_text(`☀  ${sunrise}`);
      const glibNow = GLib.DateTime.new_now(tz);
      this._date.set_text(glibNow.format('%a, %b %d'));
      this._prayers.forEach((w, i) => {
        const active = nextIndex === i || (nextIndex < 0 && i === 0);
        w.t.set_text(formatTime(today.times[i]));
        w.iq.set_text(today.iqamah[i]);
        w.n.set_style_class_name(active ? 'omar-mawaqit-prayer-name-active' : 'omar-mawaqit-prayer-name');
        w.t.set_style_class_name(active ? 'omar-mawaqit-prayer-clock-active' : 'omar-mawaqit-prayer-clock');
        w.iq.set_style_class_name(active ? 'omar-mawaqit-prayer-iqama-active' : 'omar-mawaqit-prayer-iqama');
        w.under.set_style_class_name(active ? 'omar-mawaqit-selected-underline' : 'omar-mawaqit-clear-underline');
      });
      this._setStatus('');
    } catch (e) {
      this._setStatus(`Schedule unavailable: ${String(e.message).slice(0, 42)}`);
    }
  }
}
