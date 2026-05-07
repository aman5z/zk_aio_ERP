# 🚨 School Emergency Alert System
## Setup Guide (No coding required)

---

## What you need
- A PC/laptop that stays ON during school hours (acts as server)
- School Wi-Fi (all devices on same network)
- Node.js installed (free, one-time install)

---

## Step 1 — Install Node.js (one time only)
1. Go to: https://nodejs.org
2. Download "LTS" version
3. Install it (just click Next → Next → Install)

---

## Step 2 — Set your admin password
Open `server.js` in Notepad
Find this line:
```
const ADMIN_PASSWORD = 'school2024';
```
Change `school2024` to your own password. Save the file.

---

## Step 3 — Start the server
1. Open the `alert-server` folder
2. Hold SHIFT + Right-click → "Open PowerShell window here"
3. Type this and press Enter:
```
node server.js
```
4. You'll see: `🚨 School Alert Server running on port 3000`
5. Keep this window open while school is running

---

## Step 4 — Find your PC's IP address
1. Open PowerShell or Command Prompt
2. Type: `ipconfig`
3. Look for "IPv4 Address" under Wi-Fi — e.g. `192.168.1.105`
4. Your server is now at: `http://192.168.1.105:3000`

---

## Step 5 — Share with teachers
Send teachers this link (replace with your actual IP):
```
http://192.168.1.105:3000/alert
```
Teachers should:
- Open this link on their laptop/tablet
- Bookmark it
- Leave the tab open all day

---

## Step 6 — Your admin panel
Open this on YOUR device only:
```
http://192.168.1.105:3000/
```
or just: `http://localhost:3000/`

---

## How to send an alert
1. Open admin panel
2. Enter your password
3. Choose a preset (Missile Warning, Shelter, etc.) or write custom alert
4. Click BROADCAST ALERT
5. All teachers see full-screen alert immediately with alarm sound

## How to cancel alert
Click "SEND ALL-CLEAR" — teachers see green all-clear screen then return to standby.

---

## Tips
- Keep the server PC plugged in and on
- Test it every morning (use the DRILL preset)
- Teachers must have the tab open for alerts to work
- Works on phones, tablets, laptops — any browser

---

## Files in this folder
- `server.js` — The server (don't delete)
- `admin.html` — Your control panel
- `teacher.html` — What teachers see
- `README.md` — This guide
