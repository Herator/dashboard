import json
import os
import socket
import ssl
import struct
import threading
import time

import paho.mqtt.client as mqtt
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from backend.database import get_session
from backend.models import FilamentSpool

router = APIRouter(prefix="/api/printer", tags=["printer"])

# Bambu's LAN-mode MQTT broker runs on the printer itself; "bblp" is the
# fixed username LAN mode expects, paired with the access code shown on the
# printer's network settings screen.
MQTT_PORT = 8883
MQTT_USERNAME = "bblp"

# A wall-mounted dashboard tile doesn't need sub-second freshness, and every
# poll opens a fresh MQTT connection to the printer.
_STATUS_TTL = 10

_status_cache: dict = {"data": None, "fetched_at": 0.0}

# A small curated palette rather than the full CSS3/webcolors list: AMS trays
# report a raw sensor-read hex, and matching against a huge name list tends
# to land on obscure names (e.g. "rebecca purple") for what's visually just
# "purple". Nearest-match by Euclidean RGB distance.
_NAMED_COLORS = {
    "Black": (0, 0, 0),
    "White": (255, 255, 255),
    "Gray": (128, 128, 128),
    "Silver": (192, 192, 192),
    "Red": (237, 28, 36),
    "Orange": (255, 127, 0),
    "Yellow": (255, 221, 0),
    "Gold": (212, 175, 55),
    "Green": (34, 139, 34),
    "Olive": (128, 128, 0),
    "Teal": (0, 128, 128),
    "Cyan": (0, 255, 255),
    "Blue": (30, 90, 200),
    "Navy": (0, 0, 128),
    "Purple": (128, 0, 128),
    "Pink": (255, 105, 180),
    "Magenta": (255, 0, 255),
    "Brown": (139, 69, 19),
    "Beige": (222, 196, 160),
}

# Exact hex -> name lookup for Bambu's own filament colors (every PLA line —
# Basic, Matte, Silk, Metal, Sparkle, Marble, Galaxy, Glow — as of Sep 2026),
# scraped from https://3dfilamentprofiles.com/filaments/bambu-lab/pla and
# checked before the nearest-match fallback. Muted/mixed tones (e.g.
# "#68724D", an olive-brown) land on a wrong generic name like "Gray" under
# RGB-distance matching alone. Where several color lines share one hex (pure
# black/white are near-universal), the lowest product id wins, which favors
# the plain PLA Basic name over a specialty variant. Not exhaustive for
# other materials (PETG, TPU, ABS) — those still fall through to the
# generic palette below.
_BAMBU_COLOR_NAMES = {
    "000000": "Black",
    "0047BB": "Blue",
    "004EA8": "Blue",
    "0056B8": "Cobalt Blue",
    "0078BF": "Marine Blue",
    "0086D6": "Cyan",
    "008BDA": "Blue",
    "009BD9": "Cyan",
    "009FA1": "Teal",
    "00AE42": "Bambu Green",
    "00B1B7": "Turquoise",
    "00BB31": "Green",
    "00FFFF": "Cyan",
    "018814": "Candy Green",
    "042F56": "Dark Blue",
    "0A2989": "Blue",
    "1D7C6A": "Oxide Green Metallic",
    "2842AD": "Royal Blue",
    "2D2B28": "Onyx Black Sparkle",
    "39699E": "Cobalt Blue Metallic",
    "3B665E": "Green",
    "3F5443": "Alpine Green Sparkle",
    "3F8E43": "Mistletoe Green",
    "424379": "Nebula",
    "43403D": "Iron Gray Metallic",
    "482960": "Indigo Purple",
    "483D8B": "Royal Purple Sparkle",
    "4C241C": "Rosewood",
    "4D3324": "Dark Chocolate",
    "4D5054": "Lava Gray",
    "4F3F24": "Black Walnut",
    "545454": "Dark Gray",
    "56B7E6": "Sky Blue",
    "594177": "Purple",
    "5B6579": "Blue Gray",
    "5C9748": "Matcha Green",
    "5E43B7": "Purple",
    "5F6367": "Titan Gray",
    "61C680": "Grass Green",
    "684A43": "Brown",
    "68724D": "Dark Green",
    "69398E": "Iris Purple",
    "6E88BC": "Jeans Blue",
    "6F5034": "Cocoa Brown",
    "6F6E6D": "Dark Gray",
    "757575": "Nardo Gray",
    "792B36": "Crimson Red Sparkle",
    "7AC0E9": "Glow Blue",
    "7D6556": "Dark Brown",
    "8344B0": "Purple",
    "847D48": "Bronze",
    "8671CB": "Purple",
    "8E9089": "Gray",
    "918669": "Classic Birch",
    "950051": "Plum",
    "951E23": "Burgundy Red",
    "959698": "Silver",
    "96D8AF": "Light Jade",
    "96DCB9": "Mint",
    "995F11": "Clay Brown",
    "9B9EA0": "Ash Gray",
    "9D2235": "Maroon Red",
    "9D432C": "Brown",
    "9FA19F": "Gray",
    "A1FFAC": "Glow Green",
    "A3D8E1": "Ice Blue",
    "A4DBE8": "Baby Blue",
    "A6A9AA": "Silver",
    "A8C6EE": "Baby Blue",
    "AA6443": "Copper Brown Metallic",
    "AD4E38": "Red Granite",
    "AE835B": "Caramel",
    "AE96D4": "Lilac Purple",
    "AFB1AE": "Gray",
    "B15533": "Terracotta",
    "B39B84": "Iridium Gold Metallic",
    "B50011": "Red",
    "B8ACD6": "Lavender",
    "B8CDE9": "Ice Blue",
    "BA9594": "Rose Gold",
    "BB3D43": "Dark Red",
    "BECF00": "Bright Green",
    "C12E1F": "Red",
    "C2E189": "Apple Green",
    "C8C8C8": "Silver",
    "C98935": "Ochre Yellow",
    "CBC6B8": "Bone White",
    "CDCECA": "Gray",
    "CEA629": "Classic Gold Sparkle",
    "D02727": "Candy Red",
    "D1D3D5": "Light Gray",
    "D3B7A7": "Latte Brown",
    "D6CCA3": "White Oak",
    "DC3A27": "Orange",
    "DE4343": "Scarlet Red",
    "E4BD68": "Gold",
    "E8AFCF": "Sakura Pink",
    "E8DBB7": "Desert Tan",
    "EC008C": "Magenta",
    "F17B8F": "Glow Pink",
    "F3CFB2": "Champagne",
    "F4A925": "Gold",
    "F4D53F": "Yellow",
    "F4EE2A": "Yellow",
    "F5547C": "Hot Pink",
    "F55A74": "Pink",
    "F5B6CD": "Cherry Pink",
    "F5DBAB": "Mellow Yellow",
    "F74E02": "Orange",
    "F7ADA6": "Pink",
    "F7CED7": "Milky Pink",
    "F7D959": "Lemon Yellow",
    "F7E6DE": "Beige",
    "F7F3F0": "White Marble",
    "F8FF80": "Glow Yellow",
    "F99963": "Mandarin Orange",
    "FBF5E4": "Support for PLA/PETG Nature",
    "FEC600": "Sunflower Yellow",
    "FF0000": "Red",
    "FF671F": "Orange",
    "FF6A13": "Orange",
    "FF9016": "Pumpkin Orange",
    "FF9D5B": "Glow Orange",
    "FFB549": "Sunflower Yellow",
    "FFB673": "Apricot",
    "FFD834": "Yellow",
    "FFFEF7": "White",
    "FFFFFF": "Jade White",
}


def nearest_color_name(hex_color: str) -> str:
    hex_color = hex_color.lstrip("#")
    exact = _BAMBU_COLOR_NAMES.get(hex_color.upper())
    if exact:
        return exact
    rgb = tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    return min(
        _NAMED_COLORS,
        key=lambda name: sum((a - b) ** 2 for a, b in zip(_NAMED_COLORS[name], rgb)),
    )


def parse_report(report: dict) -> dict:
    """Shape a Bambu `print` MQTT report into the widget's response.

    # ponytail: field names come from reverse-engineered community docs
    # (Bambu's LAN protocol is undocumented), not an official spec — if a
    # firmware update changes them, adjust the .get() keys here.
    """
    print_data = report.get("print", {})
    ams = []
    for unit in print_data.get("ams", {}).get("ams", []):
        for tray in unit.get("tray", []):
            if not tray.get("tray_type"):
                continue
            color = tray.get("tray_color")
            color_hex = f"#{color[:6]}" if color else None
            ams.append(
                {
                    "material": tray["tray_type"],
                    "color_hex": color_hex,
                    "color_name": nearest_color_name(color_hex) if color_hex else None,
                }
            )
    return {
        "online": True,
        "state": print_data.get("gcode_state", "UNKNOWN"),
        "progress_pct": print_data.get("mc_percent"),
        "remaining_min": print_data.get("mc_remaining_time"),
        "job_name": print_data.get("subtask_name") or None,
        "ams": ams,
    }


def fetch_report(timeout: float = 3.0) -> dict | None:
    """Pull one full status report from the printer over LAN-mode MQTT.

    Returns None if the printer isn't configured or didn't answer in time —
    callers treat that as "offline" rather than an error, since a home 3D
    printer being powered off is the normal case, not a fault.
    """
    ip = os.environ.get("BAMBU_PRINTER_IP")
    serial = os.environ.get("BAMBU_SERIAL")
    access_code = os.environ.get("BAMBU_ACCESS_CODE")
    if not (ip and serial and access_code):
        return None

    result: dict = {}
    done = threading.Event()

    def on_connect(client, userdata, flags, rc):
        client.subscribe(f"device/{serial}/report")
        client.publish(
            f"device/{serial}/request",
            json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}),
        )

    def on_message(client, userdata, msg):
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            return
        if "print" in payload:
            result["report"] = payload
            done.set()

    client = mqtt.Client()
    client.username_pw_set(MQTT_USERNAME, access_code)
    client.tls_set(cert_reqs=ssl.CERT_NONE)
    client.tls_insecure_set(True)
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(ip, MQTT_PORT, keepalive=int(timeout) + 2)
    except OSError:
        return None

    client.loop_start()
    done.wait(timeout)
    client.loop_stop()
    client.disconnect()
    return result.get("report")


def sync_ams_to_inventory(session: Session, ams: list) -> None:
    """Auto-add AMS-loaded filament that isn't already tracked on hand.

    Purely additive, like ``sync_meal_plan_to_groceries``: matched by
    (material, color) so it never re-adds or touches a spool once it exists,
    since "on hand" tracks ownership, not what's currently loaded — the
    printer has no way to say a spool ran out or was removed.
    """
    known = {
        (s.material.strip().casefold(), (s.color_hex or "").lower())
        for s in session.exec(select(FilamentSpool)).all()
    }
    for tray in ams:
        color_hex = tray.get("color_hex")
        key = (tray["material"].strip().casefold(), (color_hex or "").lower())
        if key in known:
            continue
        known.add(key)
        session.add(
            FilamentSpool(
                material=tray["material"],
                color_name=nearest_color_name(color_hex) if color_hex else "Unknown",
                color_hex=color_hex or "#ffffff",
                notes="Auto-added from printer AMS",
            )
        )
    session.commit()


@router.get("/status")
def get_printer_status(session: Session = Depends(get_session)):
    now = time.time()
    if _status_cache["data"] is not None and now - _status_cache["fetched_at"] < _STATUS_TTL:
        return _status_cache["data"]

    report = fetch_report()
    data = parse_report(report) if report else {"online": False}
    if data["online"] and data["ams"]:
        sync_ams_to_inventory(session, data["ams"])
    _status_cache["data"] = data
    _status_cache["fetched_at"] = now
    return data


CAMERA_PORT = 6000


def _camera_auth_packet(access_code: str) -> bytes:
    """Build the fixed-size handshake packet the camera port expects.

    # ponytail: reverse-engineered from community tooling, not an official
    # spec — 4 header words (0x40, 0x3000, 0, 0) followed by a 32-byte
    # username field and a 32-byte access-code field, both NUL-padded.
    """
    packet = bytearray()
    packet += struct.pack("<I", 0x40)
    packet += struct.pack("<I", 0x3000)
    packet += struct.pack("<I", 0)
    packet += struct.pack("<I", 0)
    packet += MQTT_USERNAME.encode("utf-8").ljust(32, b"\x00")
    packet += access_code.encode("utf-8").ljust(32, b"\x00")
    return bytes(packet)


def _recv_exact(sock, n: int) -> bytes | None:
    """Read exactly ``n`` bytes, or None if the connection closed early."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def read_frames(sock):
    """Yield successive JPEG frames from an authenticated camera socket.

    Each frame is preceded by a 16-byte header whose first 4 bytes are the
    payload length (little-endian uint32); the printer pushes frames
    continuously with no further requests needed after the handshake.
    Split out from ``stream_camera_frames`` so tests can feed it a fake
    socket instead of opening a real one.
    """
    while True:
        header = _recv_exact(sock, 16)
        if header is None:
            return
        length = struct.unpack("<I", header[:4])[0]
        payload = _recv_exact(sock, length)
        if payload is None:
            return
        yield payload


def stream_camera_frames():
    """Connect to the printer's LAN-mode camera port and yield JPEG frames.

    Yields nothing (an empty stream) if the printer isn't configured or the
    connection fails — same "offline, not an error" treatment as the status
    endpoint, since the camera being unreachable is the normal case when the
    printer is off.
    """
    ip = os.environ.get("BAMBU_PRINTER_IP")
    access_code = os.environ.get("BAMBU_ACCESS_CODE")
    if not (ip and access_code):
        return

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        raw = socket.create_connection((ip, CAMERA_PORT), timeout=5)
        sock = ctx.wrap_socket(raw)
    except OSError:
        return

    sock.settimeout(10)
    try:
        sock.sendall(_camera_auth_packet(access_code))
        yield from read_frames(sock)
    finally:
        sock.close()


@router.get("/camera")
def stream_camera():
    def generate():
        for frame in stream_camera_frames():
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(frame)).encode()
                + b"\r\n\r\n"
                + frame
                + b"\r\n"
            )

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
