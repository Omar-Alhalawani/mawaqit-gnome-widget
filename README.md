# Mawaqit GNOME Widget

An **unofficial GNOME Shell 50 desktop widget** for Mawaqit mosque prayer schedules on Ubuntu 26.04. It appears on your wallpaper instead of opening a GTK application. Built for a compact, unobtrusive presentation with subtle Islamic geometry, crisp native text, published iqamah times, and no audio.

**Not affiliated with Mawaqit.** Source schedules belong to their respective mosques; verify all prayer and iqamah times against the mosque's [official Mawaqit website](https://mawaqit.net/). This widget fetches publicly displayed pages, and might need maintenance when Mawaqit's site changes.

## Features

- **Three mosques** with unobtrusive `‹ ›` buttons: MAC Barrhaven Islamic Centre, South Nepean Muslim Community (SNMC), and Qurtoba Islamic Center (Ottawa)
- Five daily prayer times, next prayer and live countdown; says **tomorrow** for next-day Fajr
- Actual mosque-published **iqamah calendar** (offsets such as `+5` or clock times); missing values are shown as `—`, never invented
- Daily Isha from Mawaqit's published day schedule, accurate rollover for next-day Fajr
- Lightweight Cairo background artwork drawn natively in GNOME Shell; patterns concentrated near edges for readability
- Drag using the **white diamond grip**, or **Alt + left drag**; remembers mosque and position
- Works with GNOME Remote Login's delayed/virtual monitor initialization
- **Silent by design**; no audio, adhan playback, or notifications are implemented
- Retains cached schedules for temporary network outages

## Requirements

- Ubuntu 26.04 with **GNOME Shell 50** and `gnome-extensions`
- Internet connection to retrieve the mosque's public Mawaqit page
- No Conky, GTK application, Python runtime, or third-party browser extensions required

## Install from GitHub

```bash
cd ~
git clone https://github.com/Omar-Alhalawani/mawaqit-gnome-widget.git
cd mawaqit-gnome-widget
bash install.sh
```

**Log out and back in** (for Remote Login this disconnects your session), then:

```bash
gnome-extensions enable omar-mawaqit-desktop@local
```

Find **Mawaqit GNOME Widget** under Extension Manager → Installed. The widget appears on the primary desktop behind normal windows.

## Get updates on your Ubuntu computer

Whenever changes are pushed to this repository:

```bash
cd ~/mawaqit-gnome-widget
bash update.sh
```

The updater uses `git pull --ff-only origin main` (it will **not** overwrite local tracked modifications) and reinstalls the four extension files, preserving your settings and saving a backup of the previous installation. Log out and reconnect for GNOME to load updated JavaScript. An automatic update service is **not** installed.

`bash uninstall.sh` disables and removes **only this extension**, leaving your mosque selection/cache and any other GNOME extensions alone.

## Sources and schedule accuracy

- [MAC Barrhaven](https://mawaqit.net/en/m/mac-barrhaven-islamic-centre-ottawa-k2c-3h2-canada)
- [SNMC](https://mawaqit.net/en/south-nepean-muslim-community-snmc-ottawa-k2j-4g3-canada)
- [Qurtoba](https://mawaqit.net/en/m/qic-mousque-ottawa-k2g-5t5-canada)

The widget parses each mosque's public embedded `confData`: `times` for the current day, `calendar` for other dates, and **`iqamaCalendar` for iqamah**. No fabricated offsets are used. In particular, when it's after Isha, the countdown obtains **tomorrow's Fajr** separately rather than assuming today's Fajr + 24 hours.

If a schedule fails to load, check your network and compare with the Mawaqit website. For problems, inspect GNOME logs:

```bash
journalctl --user -b | grep -i 'mawaqit desktop' | tail -40
```

## Development

Run the parser test suite (Node.js 20+):

```bash
npm test
```

This is a **GNOME Shell extension**, not an app. `extension/extension.js` manages St actors, positioning, controls and Cairo painting. `extension/mawaqit.js` handles data parsing. `extension/stylesheet.css` controls the text/controls. GNOME 50 APIs, especially the private background group, can change in future GNOME releases.

## License

MIT for this project's original source code. Mawaqit remains a separate service/trademark; mosque timetables belong to their publishers.
