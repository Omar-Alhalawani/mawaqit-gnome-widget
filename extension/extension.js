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
// Curved botanical ornamentation: leaves, scrolling stems and soft ribbons.
// Intentionally no star polygons, interlocking triangles or occult-looking glyphs.
function paintLeaf(cr, x, y, angle, length, width, alpha) {
  cr.save();
  cr.translate(x, y);
  cr.rotate(angle);
  cr.newSubPath();
  cr.moveTo(0, 0);
  cr.curveTo(length * 0.27, -width * 0.95, length * 0.78, -width * 0.66, length, 0);
  cr.curveTo(length * 0.77, width * 0.65, length * 0.28, width * 0.84, 0, 0);
  cr.closePath();
  cr.setSourceRGBA(1, 0.86, 1, alpha * 0.44);
  cr.fillPreserve();
  cr.setSourceRGBA(1, 0.93, 1, alpha);
  cr.setLineWidth(0.85);
  cr.stroke();
  // Single curved leaf vein, never an angular / intersecting motif.
  cr.moveTo(2, 0);
  cr.curveTo(length * 0.36, -width * 0.10, length * 0.72, width * 0.09, length * 0.95, 0);
  cr.setLineWidth(0.65);
  cr.setSourceRGBA(1, 0.94, 1, alpha * 0.55);
  cr.stroke();
  cr.restore();
}

function paintVine(cr, ox, oy, side, alpha) {
  cr.save();
  cr.translate(ox, oy);
  cr.scale(side, 1);
  cr.setLineWidth(1.4);
  cr.setSourceRGBA(1, 0.88, 1, alpha);
  cr.moveTo(0, 0);
  cr.curveTo(49, -31, 12, -57, 43, -88);
  cr.curveTo(82, -126, 32, -165, 74, -211);
  cr.stroke();
  // Alternating scrolling leaves form a botanical arabesque, not a lattice.
  for (const [x, y, a, len, wide] of [
    [20, -19, -0.90, 22, 12],
    [29, -42, -2.26, 19, 11],
    [35, -76, -0.49, 24, 11],
    [43, -103, -2.36, 20, 11],
    [56, -144, -0.66, 22, 12],
    [63, -171, -2.25, 19, 11],
  ]) paintLeaf(cr, x, y, a, len, wide, alpha);
  // Tiny round buds, not points or stars.
  for (const [x, y, r] of [[45, -87, 2.7], [73, -209, 3], [15, -16, 2.2]]) {
    cr.newSubPath();
    cr.arc(x, y, r, 0, 2 * Math.PI);
    cr.setSourceRGBA(1, 0.94, 1, alpha * 0.65);
    cr.fill();
  }
  cr.restore();
}

function paintOrnaments(area) {
  const cr = area.get_context();
  try {
    const [w, h] = area.get_surface_size();
    if (w < 2 || h < 2) return;
    cr.save();
    roundedRectangle(cr, 0.5, 0.5, w - 1, h - 1, 22);
    cr.clip();

    // Velvet-violet gradient; the text in the centre remains clear.
    const ground = new Cairo.LinearGradient(0, 0, w, h);
    ground.addColorStopRGBA(0, 0.60, 0.17, 0.93, 1);
    ground.addColorStopRGBA(0.5, 0.49, 0.13, 0.86, 1);
    ground.addColorStopRGBA(1, 0.35, 0.08, 0.69, 1);
    cr.setSource(ground);
    cr.paint();

    // Long, translucent silk folds add texture without a repeating grid.
    cr.moveTo(0, h * 0.72);
    cr.curveTo(w * 0.20, h * 0.53, w * 0.37, h * 0.97, w * 0.60, h * 0.79);
    cr.curveTo(w * 0.78, h * 0.61, w * 0.91, h * 0.94, w, h * 0.68);
    cr.lineTo(w, h);
    cr.lineTo(0, h);
    cr.closePath();
    cr.setSourceRGBA(0.95, 0.76, 1, 0.045);
    cr.fill();

    cr.setLineWidth(20);
    cr.setSourceRGBA(0.96, 0.81, 1, 0.035);
    cr.moveTo(-25, h - 25);
    cr.curveTo(120, h - 95, 180, h + 12, 320, h - 38);
    cr.curveTo(430, h - 87, 480, h + 13, w + 24, h - 47);
    cr.stroke();

    // Ornament stays on the edges; no sharp or intersecting star motifs.
    paintVine(cr, w + 10, h + 9, -1, 0.105);
    paintVine(cr, -14, h + 28, 1, 0.065);
    // A quiet curling line at the upper-right corner.
    cr.setLineWidth(1.05);
    cr.setSourceRGBA(1, 0.92, 1, 0.065);
    cr.moveTo(w - 45, -14);
    cr.curveTo(w - 12, 21, w - 91, 34, w - 38, 71);
    cr.stroke();

    // Single soft rim, very low contrast.
    roundedRectangle(cr, 1, 1, w - 2, h - 2, 21);
    cr.setLineWidth(1);
    cr.setSourceRGBA(1, 0.94, 1, 0.095);
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
      child: label('☾', 'omar-mawaqit-mark'),
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
      this._countPrefix.set_text(nextIndex < 0 ? `${nextName} tomorrow` : `${nextName} in`);
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
