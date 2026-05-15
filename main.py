#!/usr/bin/env python3
"""
Attendance ZTech System – with self-healing RT capture and EoD push.
"""

import asyncio
import logging
import json
import os
import sys
from multiprocessing import Process, Manager
from multiprocessing.managers import BaseProxy
from datetime import datetime, date, timedelta
import time
from zk import ZK
import httpx
from pathlib import Path
from socket import gethostbyname
import socket
import subprocess
from telegram_notifier import TelegramNotifier

# =========================
# Helpers: logging & setup
# =========================

def setup_logging():
    log_dir = Path("logs")
    log_dir.mkdir(parents=True, exist_ok=True)

    desktop_dir = Path(os.path.expanduser("~/Desktop"))
    desktop_logs = None
    if desktop_dir.exists():
        desktop_logs = desktop_dir / "AttendanceZTech Logs"
        desktop_logs.mkdir(exist_ok=True)

    main_log = log_dir / "attendance.log"
    desktop_log = (desktop_logs / "attendance.log") if desktop_logs else None

    formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    logger = logging.getLogger('AttendanceZTech')
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fh = logging.FileHandler(main_log, encoding='utf-8')
    fh.setLevel(logging.INFO)
    fh.setFormatter(formatter)
    logger.addHandler(fh)

    if desktop_log:
        dh = logging.FileHandler(desktop_log, encoding='utf-8')
        dh.setLevel(logging.INFO)
        dh.setFormatter(formatter)
        logger.addHandler(dh)

    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(formatter)
    logger.addHandler(ch)

    local = logging.FileHandler("log.txt", encoding='utf-8')
    local.setLevel(logging.INFO)
    local.setFormatter(formatter)
    logger.addHandler(local)

    return logger

logger = setup_logging()
logger.info(
    "=== Attendance ZTech System Started ===\n"
    f"Timestamp: {datetime.now()}\n"
    f"Python: {sys.version.split()[0]}\n"
    f"CWD: {os.getcwd()}\n"
    "======================================="
)

# =========================
# Config & Telegram
# =========================

def load_config():
    try:
        with open("config.json", "r") as f:
            cfg = json.load(f)
        return cfg
    except Exception as e:
        logger.error(f"Failed to load config.json: {e}")
        sys.exit(1)

def _load_creds_txt():
    """Load creds.txt from script directory or its parent. Returns a flat dict."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    for d in (script_dir, os.path.dirname(script_dir)):
        path = os.path.join(d, 'creds.txt')
        if os.path.exists(path):
            creds = {}
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith('#'):
                            continue
                        if '=' in line:
                            k, _, v = line.partition('=')
                            creds[k.strip()] = v.strip()
                return creds
            except Exception:
                pass
    return {}

config = load_config()
_creds = _load_creds_txt()

# Override config.json telegram/endpoint values from creds.txt if present
if _creds.get('gaes_telegram_bot_token') or _creds.get('gaes_telegram_chat_id'):
    tg_config = config.setdefault('telegram', {})
    if _creds.get('gaes_telegram_bot_token'):
        tg_config['bot_token'] = _creds['gaes_telegram_bot_token']
    if _creds.get('gaes_telegram_chat_id'):
        tg_config['chat_id'] = _creds['gaes_telegram_chat_id']
if _creds.get('gaes_sync_endpoint'):
    config['endpoint'] = _creds['gaes_sync_endpoint']
ENDPOINT = config["endpoint"]
BUFFER_LIMIT = int(config["buffer_limit"])
DEVICES = config["devices"]

telegram_config = config.get("telegram", {})
system_name = config.get("name", "Attendance System")
telegram_notifier = TelegramNotifier(
    bot_token=telegram_config.get("bot_token", ""),
    chat_id=telegram_config.get("chat_id", ""),
    enabled=telegram_config.get("enabled", False),
    notification_settings=telegram_config.get("notifications", {}),
    system_name=system_name
)

logger.info(f"Configured devices: {len(DEVICES)} | Endpoint: {ENDPOINT} | Buffer limit: {BUFFER_LIMIT} | Telegram: {'ENABLED' if telegram_notifier.enabled else 'DISABLED'}")

# =========================
# Network helpers
# =========================

def wait_for_network(max_wait_s=120):
    start = time.time()
    while time.time() - start < max_wait_s:
        try:
            gethostbyname("api.telegram.org")
            gethostbyname("google.com")
            with socket.create_connection(("8.8.8.8", 53), timeout=3):
                return True
        except OSError:
            time.sleep(3)
    return False

def _ping_cmd(host):
    """Return a cross-platform ping command list for a single-packet ping."""
    if sys.platform.startswith("win"):
        return ["ping", "-n", "1", "-w", "1000", host]
    return ["ping", "-c", "1", "-W", "1", host]

def any_device_ping_ok(hosts, max_wait_s=60):
    start = time.time()
    while time.time() - start < max_wait_s:
        for h in hosts:
            try:
                rc = subprocess.call(_ping_cmd(h),
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if rc == 0:
                    return True
            except Exception:
                pass
        time.sleep(3)
    return False

def wait_port_open(host: str, port: int, timeout_s: int = 3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False

# =========================
# Telegram safe send
# =========================

def tg_send_safe(html_text: str, retries=3, backoff_s=2):
    if not telegram_notifier.enabled:
        return
    for i in range(retries):
        try:
            telegram_notifier.send_message_sync(html_text)
            return
        except Exception as e:
            logger.error(f"Telegram send failed (attempt {i+1}/{retries}): {e}")
            time.sleep(backoff_s * (i + 1))

def tg_send_with_name(message: str, retries=3, backoff_s=2):
    if not telegram_notifier.enabled:
        return
    if f"{system_name} -" not in message and "<b>" in message:
        message = message.replace("<b>", f"<b>{system_name} - ", 1)
    tg_send_safe(message, retries, backoff_s)

# =========================
# JSON helpers
# =========================

def _to_plain(obj):
    if isinstance(obj, BaseProxy):
        try:
            obj = list(obj)
        except Exception:
            try:
                obj = dict(obj)
            except Exception:
                return str(obj)
    if isinstance(obj, dict):
        return {k: _to_plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_plain(x) for x in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj

# =========================
# Device connection helpers
# =========================

def connect_with_retry(device, max_attempts=5, base_sleep=2, timeout=20):
    ip = device["ip_address"]
    port = device["port"]
    pwd = device.get("password", 0)
    for attempt in range(1, max_attempts + 1):
        if not wait_port_open(ip, port, timeout_s=3):
            logger.info(f"⛔ Port {ip}:{port} not reachable (attempt {attempt}/{max_attempts})")
            time.sleep(base_sleep * attempt)
            continue

        try:
            zk = ZK(ip, port=port, timeout=timeout, password=pwd, force_udp=False, ommit_ping=True)
            conn = zk.connect()
            if conn:
                try:
                    conn.enable_device()
                except Exception:
                    pass
                logger.info(f"✅ Connected to {device['device_id']} ({ip}:{port})")
                return conn, zk
        except Exception as e:
            logger.info(f"🔁 Connect failed dev {device['device_id']} (attempt {attempt}/{max_attempts}): {e}")
        time.sleep(base_sleep * attempt)
    logger.error(f"❌ Could not connect to dev {device['device_id']} after {max_attempts} attempts")
    return None, None

# =========================
# Push to server
# =========================

def push_to_server(attendance_buffer, device_id=None):
    records_plain = _to_plain(attendance_buffer)
    if not records_plain:
        return True

    payload = {"Json": records_plain}
    record_count = len(records_plain)

    logger.info(f"Pushing {record_count} records to {ENDPOINT}")
    try:
        with httpx.Client(timeout=50) as client:
            resp = client.post(ENDPOINT, json=payload, headers={"Content-Type": "application/json"})
        if resp.status_code == 200:
            logger.info(f"✅ Push success ({record_count} records)")
            try:
                if isinstance(attendance_buffer, BaseProxy):
                    attendance_buffer[:] = []
                else:
                    attendance_buffer.clear()
            except Exception:
                pass
            return True
        else:
            logger.error(f"❌ Push failed HTTP {resp.status_code}: {resp.text[:500]}")
            return False
    except Exception as e:
        logger.error(f"❌ Push error: {e}")
        return False

# =========================
# Real-time capture (improved)
# =========================

def capture_real_time_logs(device, shared_buffer, periodic_flush_s=60, idle_reconnect_s=180):
    device_id = device['device_id']
    ip_address = device['ip_address']
    port = device['port']

    logger.info(f"🔌 Starting RT capture for device {device_id} ({ip_address}:{port})")
    last_flush = time.time()
    last_event = time.time()

    while True:
        conn, zk = connect_with_retry(device, max_attempts=6, base_sleep=2, timeout=20)
        if not conn:
            time.sleep(10)
            continue

        try:
            try:
                info = conn.get_device_info()
                logger.info(f"ℹ️ Device {device_id} info: {info}")
            except Exception:
                logger.info(f"ℹ️ Device {device_id} connected (info unavailable)")

            for attendance in conn.live_capture():
                now = time.time()

                if attendance:
                    last_event = now
                    log_entry = {
                        "device_id": device_id,
                        "user_id": int(attendance.user_id),
                        "timestamp": attendance.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                        "status": attendance.status,
                        "punch": attendance.punch,
                    }
                    logger.info(f"🕘 New attendance: user {attendance.user_id} @ {log_entry['timestamp']} (Dev {device_id})")
                    shared_buffer.append(log_entry)

                    if len(shared_buffer) >= BUFFER_LIMIT:
                        logger.info(f"📤 Buffer ≥ {BUFFER_LIMIT}, pushing...")
                        push_to_server(shared_buffer, device_id)

                if (now - last_flush) >= periodic_flush_s and len(shared_buffer) > 0:
                    logger.info(f"⏱️ Periodic flush ({len(shared_buffer)} recs)")
                    push_to_server(shared_buffer, device_id)
                    last_flush = now

                if (now - last_event) >= idle_reconnect_s:
                    try:
                        _ = conn.get_time()
                        last_event = now
                    except Exception as hb_e:
                        logger.warning(f"💤 Idle reconnect (dev {device_id}): heartbeat failed: {hb_e}")
                        break

            logger.info(f"🔁 live_capture ended for dev {device_id}; reconnecting...")

        except Exception as e:
            logger.error(f"❌ RT capture loop error dev {device_id}: {e}")

        finally:
            try:
                conn.enable_device()
                conn.disconnect()
            except Exception:
                pass

        time.sleep(3)

# =========================
# Process orchestration
# =========================

def reconnect_devices(shared_buffer):
    logger.info("🔁 Spawning RT capture processes...")
    processes = []
    for d in DEVICES:
        logger.info(f"▶️ Starting process for device {d['device_id']}")
        p = Process(target=capture_real_time_logs, args=(d, shared_buffer))
        p.start()
        processes.append(p)
        logger.info(f"✅ Process started dev {d['device_id']} (PID {p.pid})")
    logger.info(f"✅ All {len(processes)} device processes started")
    return processes

def stop_processes(processes, join_timeout=5):
    for p in processes:
        try:
            p.terminate()
        except Exception:
            pass
    for p in processes:
        try:
            p.join(timeout=join_timeout)
        except Exception:
            pass

# =========================
# Main loop
# =========================

def main():
    logger.info("🚀 Boot checks: waiting for network/DNS...")
    if not wait_for_network(120):
        logger.warning("Network/DNS not ready after 120s; continuing anyway...")
    else:
        logger.info("✅ Network/DNS looks OK")

    device_hosts = [d["ip_address"] for d in DEVICES]
    logger.info("🔎 Waiting for at least one device to respond to ping...")
    if not any_device_ping_ok(device_hosts, 60):
        logger.warning("No devices responded to ping within 60s; continuing anyway...")
    else:
        logger.info("✅ Ping OK for at least one device")

    with Manager() as manager:
        shared_buffer = manager.list()
        logger.info("🧺 Shared buffer ready")

        processes = reconnect_devices(shared_buffer)
        logger.info("🔗 Initial device connections done")

        try:
            logger.info("⏰ Entering main loop...")
            logger.info(f"Attendance ZTech started at {datetime.now():%Y-%m-%d %H:%M:%S}")
            while True:
                if len(shared_buffer) >= BUFFER_LIMIT:
                    logger.info("📤 Main loop flush due to size")
                    push_to_server(shared_buffer)
                time.sleep(1)

        except KeyboardInterrupt:
            logger.info("⏹️ Terminated by user")
        except Exception as e:
            logger.error(f"❌ Unexpected error in main loop: {e}")
        finally:
            logger.info("🛑 Stopping device processes...")
            stop_processes(processes)

            if len(shared_buffer) > 0:
                logger.info(f"📤 Final flush of {len(shared_buffer)} records...")
                push_to_server(shared_buffer)

            logger.info("👋 Attendance ZTech stopped")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("⏹️ Script terminated by user")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
        sys.exit(1)
