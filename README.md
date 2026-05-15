# ZKTeco Attendance System

A full attendance management solution for ZKTeco biometric devices. It includes a real-time logger that streams punch events to a local SQLite database, a feature-rich web dashboard (ERP Console) for attendance management and IT operations, bulk sync utilities, and multi-channel notifications.

---

## Components

| File | Purpose |
|------|---------|
| `main.py` | Real-time attendance logger — streams live punch events from all devices to the local database and external API |
| `server.py` | Flask web dashboard (v2.2) — full ERP Console backend with attendance, device management, ticketing, messaging, and admin APIs |
| `sync_all.py` | Bulk sync CLI — pull all logs from devices and push to API (supports date range and per-device filtering) |
| `sync_db.py` | Database sync CLI — imports employees from MDB/CSV, pulls device logs into local SQLite |
| `boot_sync_60d.py` | Startup sync — syncs the last 60 days of logs on system boot |
| `gaes-py-zk/boot_sync_30d.py` | GAS-edition startup sync — syncs the last 30 days on boot |
| `mdb_tools.py` | MDB/Access tools — export employees, generate absent reports from MDB backup |
| `telegram_notifier.py` | Telegram bot — sends device status, punch, and daily report notifications; interactive command handler for attendance queries, employee lookup, device control, and system stats |
| `code.gs` | Google Apps Script backend — IT Helpdesk, token queues, Drive storage, and GAS-side authentication |

---

## Features

### Core Attendance
- Live real-time capture from multiple ZKTeco devices (self-healing reconnect, per-device threads)
- Buffered push to external API endpoint with configurable batch size
- Local SQLite storage (WAL mode) for all punches and employees
- Date-range bulk sync with `--from` / `--to` flags and `--device-id` filtering
- Import employees from MDB (Access), CSV, or XLSX files
- Startup auto-sync scripts (last 30 or 60 days)

### Web Dashboard
- Secure login with admin and employee roles
- Role-Based Access Control (RBAC) — configurable per-user permissions
- Light / Dark / Dracula / Nord UI themes (stored server-side per user)
- User avatar upload and password self-service change
- Server-Sent Events (SSE) for live page refresh without polling
- Session management — list, revoke individual or all sessions for a user
- Configurable inactivity auto-logout (per role)
- Audit log — every sensitive action is recorded with timestamp, IP, and user agent

### Human Resources & Attendance
- **Today's dashboard:** real-time present/absent counts and per-department percentages
- **Historical reports:** date-range attendance with late/early-leave detection
- **Employee calendar:** monthly punch timeline with shift and grace-period annotations
- **Monthly summary:** per-employee worked-days, late days, and early-leave summary
- **Raw attlogs view:** filterable badge/date punch records
- **Remote punch:** employees can punch in/out from the browser (offline-capable via IndexedDB)
- **Shift configuration:** department-specific start time, end time, and grace period
- **Workday configuration:** per-department and per-employee working-day overrides
- **Holiday management:** add/delete holidays with global, department, or individual scope
- **Employee activation/deactivation and deletion**
- **Unknown user resolution:** auto-map or manually map device UIDs to employee badges

### Reporting & Exports
- Export today's attendance to **Excel (XLSX)** and **PDF**
- Export date-range history to **Excel** and **PDF**
- Export individual employee reports to **Excel** and **PDF**
- **WhatsApp/plain-text absent export** — formatted message grouped by department
- **Scheduled email report** — HTML + plain-text daily absent report via Gmail SMTP at a configured time
- **Scheduled Telegram daily report** — absent summary sent to a Telegram chat at a configured time

### Hardware Management (ZKTeco Devices)
- Monitor online/offline status for all configured devices
- View device serial number, platform, and enrolled user count
- **Remote actions:** ping, sync clock, reboot
- **Download enrolled users** from a device as JSON
- **Download fingerprint templates** from a device as base64-encoded JSON
- **Download raw attendance log** from a device as CSV

### Notifications
- **Telegram:** device online/offline alerts, per-punch notifications, scheduled daily absent report
- **Email (Gmail SMTP):** scheduled daily absent report with HTML and plain-text body
- All notification settings configurable from the Admin UI without restarting

#### Telegram Bot Commands

The bot responds to the following text commands (or `/slash` equivalents):

| Category | Command | Description |
|----------|---------|-------------|
| **Attendance** | `today summary` | Present / absent / total counts + punch count |
| | `today absent` | Full absent list grouped by department |
| | `dept summary` | Per-department attendance breakdown |
| | `week summary` | Day-by-day present/absent from Mon to today |
| | `month summary` | Department attendance % for the current month |
| | `cache refresh` | Trigger an immediate data refresh |
| **Employees** | `user attendance` | Date-wise punches with inline calendar picker |
| | `user search` | Search by name or badge; shows today's punch times |
| | `user <name/badge>` | Direct lookup, e.g. `user 1024` |
| | `user report` | Punch times for a specific employee today |
| | `late today` | Employees who arrived after their shift start |
| | `early exits` | Employees who left before their shift end |
| | `who is in` | Employees currently in the office |
| | `top absent` | Top 10 most absent employees this month |
| **Devices** | `device status` | Online / offline status of all devices |
| | `device sync` | Sync time and users across all devices |
| | `device reboot` | Reboot a device (interactive list) |
| | `unknown users` | Badge IDs not matched to any employee |
| | `punch feed` | 20 most recent punch records |
| **System** | `pending punches` | Punch corrections awaiting approval |
| | `holiday check` | Today's holiday and upcoming holidays (30 days) |
| | `db stats` | Employee count, total records, and DB file size |
| | `help` | Show the full command reference |

### IT Services & Collaboration
- **Helpdesk Ticketing:** create, assign, and track IT support tickets with priority levels and due dates
- **Token Queue / Counters:** digital service counters (HR, Finance, Medical, etc.) with visual queue
- **Notice Board:** post and manage announcements visible to all users
- **Internal Messaging:** peer-to-peer chat between dashboard users with read receipts
- **VoIP Calling:** real-time browser-to-browser voice calls via WebRTC + Socket.IO signaling
- **Sticky Notes:** private, per-user color-coded notes stored in the database
- **Google Drive Integration:** browse and upload files to a designated Drive folder (via GAS)
- **Linode / Cloud Terminal:** integrated web shell via `ttyd` and an nginx proxy

### 🆘 SOS Emergency Broadcast
- Broadcast critical emergency alerts (missile warning, lockdown, fire, evacuation, shelter-in-place) to all connected teacher devices in real-time
- Teacher view (`/sos`) displays full-screen alert with audio siren and multi-level severity (Critical / High / Info)
- Arabic title support for bilingual schools
- One-click preset alerts for common emergency scenarios
- Live teacher count — heartbeat-based presence tracking shows how many teacher screens are active
- All-clear broadcast returns teacher screens to standby automatically

### Database & Admin Tools
- **SQL Console:** run raw SQLite queries directly from the UI (admin only)
- **DB Backup:** download the full SQLite database as a file
- **DB Local Backup:** write a timestamped backup to the server's local filesystem
- **CSV Import:** bulk-import punches from a CSV file
- **MDB Import:** pull punches from an Access MDB backup into the local database
- Auto-sync scheduler configurable from the Admin UI

### Built-in IT Toolkit (client-side, no server needed)
- **Email Batch Manager:** parse `.xlsx` files, extract, deduplicate, and batch emails
- **Generators:** QR codes, Code128 barcodes, and secure passwords
- **PDF Tools:** merge, split, compress, and watermark PDFs in-browser using `pdf-lib`
- **Networking:** IP/DNS lookup, Subnet Calculator, MAC Vendor lookup, live Ping Monitor charts
- **Data Formatting:** Base64 encode/decode, Hex/Dec/Bin converters, Text Diff checker

### Progressive Web App (PWA)
- Service Worker with offline caching
- Offline punch queue stored in IndexedDB — syncs automatically when back online
- Installable on Android, iOS, and desktop

---

## Requirements

- **Python** 3.8 or later
- Dependencies listed in `requirements.txt`
- Linux/macOS/Termux: `mdbtools` system package (for MDB file reading)
- Windows: Microsoft Access Database Engine (pyodbc) for MDB features

---

## Quick Start

### Linux

```bash
bash install.sh       # installs packages, exports employees, syncs devices
bash attendance.sh    # interactive menu
```

### macOS

```bash
brew install mdbtools   # for MDB file reading (optional)
bash install.sh         # installs remaining packages
bash attendance.sh      # interactive menu
```

### Android (Termux)

```bash
pkg install python sqlite mdbtools   # system packages
bash install.sh                      # installs Python packages
bash attendance.sh                   # interactive menu
```

**Auto-start on Android boot (Termux:Boot):**
1. Install the [Termux:Boot](https://wiki.termux.com/wiki/Termux:Boot) add-on.
2. Open Termux:Boot once to grant permissions.
3. Create the boot script:
   ```bash
   mkdir -p ~/.termux/boot
   # Replace ~/ZKTeco with the actual path to your ZKTeco folder
   echo '#!/data/data/com.termux/files/usr/bin/bash
   cd ~/ZKTeco
   python server.py &' > ~/.termux/boot/start-attendance.sh
   chmod +x ~/.termux/boot/start-attendance.sh
   ```

### Windows

```bat
attendance.bat        # interactive menu
```

### Manual

```bash
python3 -m venv venv
source venv/bin/activate        # Linux/macOS/Termux
# venv\Scripts\activate         # Windows

pip install -r requirements.txt

# Real-time logger (pushes live events to API + local DB)
python main.py

# Web dashboard
python server.py      # open http://localhost:5000
```

---

## Platform Notes

| Feature | Windows | Linux | macOS | Android (Termux) |
|---------|---------|-------|-------|-----------------|
| Dashboard (`server.py`) | ✅ | ✅ | ✅ | ✅ |
| Device sync (`sync_db.py`) | ✅ | ✅ | ✅ | ✅ |
| MDB import | ✅ pyodbc | ✅ mdbtools | ✅ mdbtools | ✅ mdbtools |
| Real-time logger (`main.py`) | ✅ | ✅ | ✅ | ✅ |
| Auto-start | Task Scheduler / bat | systemd | launchd | Termux:Boot |

---

## Configuration

### `config.json` — Real-time logger & boot sync

```json
{
  "name": "Your-System-Name",
  "log_level": "INFO",
  "endpoint": "https://your-domain.example.com/erp-api/sync/empAttSync.php",
  "buffer_limit": 10,
  "devices": [
    { "device_id": 1, "ip_address": "10.20.141.21", "port": 4370 },
    { "device_id": 2, "ip_address": "10.20.141.22", "port": 4370 }
  ],
  "telegram": {
    "bot_token": "YOUR_TELEGRAM_BOT_TOKEN",
    "chat_id": "YOUR_TELEGRAM_CHAT_ID",
    "enabled": false,
    "notifications": {
      "startup": true,
      "end_of_day": true,
      "data_push": true,
      "errors": true,
      "device_status": true
    }
  }
}
```

### `settings.ini` — Web dashboard

Edit `settings.ini` to configure device IPs, departments, session timeouts, Telegram settings, and the dashboard port. Key sections:

| Section | Key settings |
|---------|-------------|
| `[devices]` | IP list, port, connection timeout, pull timeout |
| `[server]` | Dashboard port, cache refresh interval |
| `[database]` | Optional path to MDB backup file |
| `[departments]` | Excluded depts, collapsed depts, display order |
| `[sessions]` | Session lifetime, admin/employee inactivity timeout |
| `[app]` | Version string, default admin password |
| `[telegram]` | Bot token, chat ID, per-notification toggles, daily report time |
| `[voip]` | Optional TURN server URL, username, and credential for WebRTC audio through NAT |

---

## Utilities

```bash
# Sync all logs for a date range
python sync_all.py --from 2026-01-01 --to 2026-04-01

# Sync a specific device only
python sync_all.py --device-id 2

# Import employees + pull device logs into local DB
python sync_db.py

# Export employee list from MDB
python mdb_tools.py export

# Generate today's absent report
python mdb_tools.py today
```

---

## Docker

```bash
docker build -t zkteco-attendance .
docker run --network host zkteco-attendance
```

---

## License

This project is licensed under the MIT License.

---

## 🏢 ERP Console (Web Dashboard)

A unified, high-performance web dashboard merging the ZKTeco Biometric Attendance System with an IT Helpdesk and AD Console. Built entirely with Vanilla HTML, CSS, and JavaScript — no build step required.

<img src="https://github.com/user-attachments/assets/6c291473-75cd-4f0a-b634-afcc75cbdc84">

### Overview

The ERP Console connects to two primary backends:
1. **ZKTeco Local Server** — Python/Flask API (v2.2) handling local biometric hardware, SQLite employee databases, attendance logs, messaging, ticketing, and all admin functions.
2. **Google Apps Script (GAS)** — Cloud backend managing IT Helpdesk tickets, token queues, Drive storage, and GAS-side authentication.

It features full PWA support, offline punch caching via IndexedDB, four UI themes, and a built-in suite of IT networking and utility tools.

---

### 👥 Human Resources & Attendance

- **Live Dashboard:** Real-time present/absent employee counts with per-department attendance percentages and offline device tracking.
- **Today's Attendance:** Full present/absent list with late/early-leave indicators.
- **Historical Reports:** Date-range attendance reports with late and early-leave detection, exportable to Excel and PDF.
- **Employee Calendar:** Monthly punch timeline per employee, with shift and grace-period annotations.
- **Monthly Summary:** Per-employee summary of worked days, late days, and early-leave occurrences.
- **Raw Attlogs:** Filterable raw punch records (badge, date range) with CSV-level detail.
- **Remote Punching:** Employees can punch in/out from any browser. Offline support saves punches to IndexedDB and syncs when back online.
- **Shift Admin:** Configure department-specific shift start/end times and grace periods.
- **Workday Admin:** Set working days per department or override per individual employee.
- **Holiday Management:** Add/delete holidays scoped to all employees, a specific department, or individual employees.

<img src="https://github.com/user-attachments/assets/a3e2ae7e-5724-43a8-b68b-9e6c7fc3c6b5">

---

### 📡 Hardware Management (ZKTeco)

- **Device Fleet Control:** Monitor online/offline status, serial number, platform, and enrolled user count for all connected ZKTeco terminals.
- **Remote Actions:** Ping devices, sync clocks, reboot terminals directly from the dashboard.
- **Data Downloads:** Download enrolled users (JSON), fingerprint templates (base64 JSON), and raw attendance logs (CSV) from any device with a single click.
- **Unknown User Resolution:** Automatically or manually map device UIDs that don't match any employee badge.

<img src="https://github.com/user-attachments/assets/f0d928be-4d1b-4734-8e00-04b0df7f1097">

---

### 📊 Reporting & Notifications

- **Export Reports:** Export today's attendance, date-range history, or individual employee reports to **Excel (XLSX)** or **PDF**.
- **WhatsApp/Plain-Text Export:** One-click absent list formatted for WhatsApp, grouped by department.
- **Scheduled Email Report:** Daily absent report (HTML + plain-text) delivered via Gmail SMTP at a configured time.
- **Scheduled Telegram Report:** Daily absent summary sent to a Telegram group or channel at a configured time.
- **Per-Punch Telegram Alerts:** Instant notification for every punch event (togglable).
- **Device Status Alerts:** Telegram notification when any device goes online or offline.
- **Interactive Telegram Bot:** Query attendance, look up employees, control devices, and pull system stats directly from any Telegram chat using the built-in bot commands (see [Telegram Bot Commands](#telegram-bot-commands) above).

---

### 🎫 IT Services & Collaboration

- **Helpdesk Ticketing:** Create, assign, and track IT support tickets with priority levels and due dates.
- **Token Queue / Counters:** Digital service counters (HR, Finance, Medical, etc.) with live visual queue display.
- **Notice Board:** Post and manage announcements visible to all logged-in users.
- **Internal Messaging:** Peer-to-peer chat between dashboard users with read receipts and online presence indicators.
- **VoIP Calling:** Real-time browser-to-browser voice calls via WebRTC + Socket.IO signaling, with call history.
- **Sticky Notes:** Private, per-user color-coded notes persisted in the database.
- **Google Drive Integration:** Browse and upload files directly to a designated Google Drive folder (via GAS backend).
- **Cloud Terminal:** Integrated web shell connecting to your server via `ttyd` and an nginx proxy.

### 🆘 SOS Emergency Broadcast

- Broadcast critical emergency alerts to all connected teacher screens in real-time via Server-Sent Events.
- Teacher view (`/sos`) displays a full-screen alert with audio siren and multi-level severity (Critical / High / Info).
- Arabic title support for bilingual schools; preset scenarios for missile warnings, lockdowns, fires, evacuations, and drills.
- Live heartbeat-based teacher count shows exactly how many teacher screens are actively connected.
- All-clear broadcast automatically returns teacher screens to standby.

<img src="https://github.com/user-attachments/assets/33247b6e-dec4-4f83-9b63-8d9d577368ae">
<img src="https://github.com/user-attachments/assets/5ee74551-b9e5-44d4-906d-88317393e6c4">

---

### 🔧 Admin & Database Tools

- **SQL Console:** Execute raw SQLite queries directly from the Admin panel.
- **DB Backup:** Download the full SQLite database file, or write a timestamped local backup.
- **CSV/MDB Import:** Bulk-import punch records from CSV files or an Access MDB backup.
- **Audit Log:** Full history of every sensitive action (login, export, device command, etc.) with timestamp, IP address, and user agent.
- **Session Manager:** View all active sessions, revoke individual sessions, or force-logout all sessions for a specific user.
- **User Management:** Create, edit, and delete dashboard users with fine-grained permission assignment.
- **Email & Telegram Settings:** Configure notification credentials and schedules from the UI without editing config files.
- **Auto-Sync Scheduler:** Configure automatic database synchronisation intervals from the Admin panel.

---

### 🧰 Built-in IT Toolkit

A comprehensive suite of client-side utilities built into the app — no server calls required:

- **Email Batch Manager:** Parse `.xlsx` files, extract, deduplicate, and batch emails for mass communication.
- **Generators:** QR codes, Code128 barcodes, and secure passwords.
- **PDF Tools:** Merge, split, compress, and watermark PDFs entirely in the browser using `pdf-lib`.
- **Networking:** IP/DNS Lookup, Subnet Calculator, MAC Vendor lookup, and live Ping Monitor charts.
- **Data Formatting:** Base64 encoding/decoding, Hex/Dec/Bin converters, and a Text Diff checker.

<img src="https://github.com/user-attachments/assets/06b9f97f-e4b6-424f-9723-44fbeb9f35b8">
<img src="https://github.com/user-attachments/assets/2cf96f77-d44d-49b8-b436-f5771df9ec70">
<img src="https://github.com/user-attachments/assets/1badf3c7-753e-4fdd-91a5-4cfb99e131c8">

---

### 🛠️ Tech Stack

| Layer | Details |
|-------|---------|
| **Backend** | Python 3.8+, Flask, SQLite (WAL mode), `pyzk` for device communication |
| **Real-time** | Flask-SocketIO (WebRTC VoIP signaling), Server-Sent Events (SSE) for live refresh and SOS alerts |
| **Frontend** | HTML5, CSS3 (Native CSS Variables + 5 built-in themes), Vanilla JavaScript (ES6+), 22 modular JS files |
| **Offline Storage** | `localStorage` for settings; `IndexedDB` + Service Workers for offline punch caching |
| **External Libraries (CDN)** | `JsBarcode`, `qrcode.js`, `pdf-lib`, `SheetJS / xlsx`, `Chart.js`, `Socket.IO` |
| **Notifications** | Telegram Bot API, Gmail SMTP (SSL) |
| **Cloud Backend** | Google Apps Script (GAS) for ticketing, Drive, and token queues |

<img src="https://github.com/user-attachments/assets/2e95a033-1456-4a70-ba1b-cba16c7ebd58">

---

### 🎮 Demo Mode

Don't have the backends set up yet? Click **"🎮 Enter Demo Mode"** on the login screen to explore the full UI with mock employees, tickets, devices, and attendance data — no server required.

---

### 🔒 Security Notes

- All API routes are protected by `@login_required` or `@admin_required` decorators; the frontend RBAC only controls UI visibility.
- Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes — never in plain text.
- Sessions are tracked server-side and can be revoked instantly by an admin.
- The audit log records every sensitive action for accountability.

---

**Author:** Hashiq V H

