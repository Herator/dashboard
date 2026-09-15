import struct

from sqlmodel import select

import backend.printer as printer_module
from backend.models import FilamentSpool
from backend.printer import (
    parse_report,
    sync_ams_to_inventory,
    nearest_color_name,
    _camera_auth_packet,
    read_frames,
    _status_cache,
)


def reset_cache():
    _status_cache["data"] = None
    _status_cache["fetched_at"] = 0.0


class FakeCameraSocket:
    """Feeds pre-recorded bytes to ``read_frames`` in arbitrary chunk sizes,
    the way a real TCP socket would split a frame across multiple recv()s.
    """

    def __init__(self, data: bytes, chunk_size: int = 7):
        self._data = data
        self._chunk_size = chunk_size

    def recv(self, n: int) -> bytes:
        chunk = self._data[: min(n, self._chunk_size)]
        self._data = self._data[len(chunk) :]
        return chunk


def _framed(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\x00" * 12 + payload


def test_parse_report_extracts_print_state_and_ams_trays():
    report = {
        "print": {
            "gcode_state": "RUNNING",
            "mc_percent": 42,
            "mc_remaining_time": 37,
            "subtask_name": "benchy",
            "ams": {
                "ams": [
                    {
                        "tray": [
                            {"tray_type": "PLA", "tray_color": "FF0000FF"},
                            {"tray_type": "", "tray_color": ""},
                        ]
                    }
                ]
            },
        }
    }

    result = parse_report(report)

    assert result == {
        "online": True,
        "state": "RUNNING",
        "progress_pct": 42,
        "remaining_min": 37,
        "job_name": "benchy",
        "ams": [{"material": "PLA", "color_hex": "#FF0000", "color_name": "Red"}],
    }


def test_parse_report_handles_missing_print_key():
    assert parse_report({}) == {
        "online": True,
        "state": "UNKNOWN",
        "progress_pct": None,
        "remaining_min": None,
        "job_name": None,
        "ams": [],
    }


def test_status_endpoint_is_offline_when_unconfigured(client, monkeypatch):
    monkeypatch.delenv("BAMBU_PRINTER_IP", raising=False)
    monkeypatch.delenv("BAMBU_SERIAL", raising=False)
    monkeypatch.delenv("BAMBU_ACCESS_CODE", raising=False)
    reset_cache()

    resp = client.get("/api/printer/status")

    reset_cache()
    assert resp.status_code == 200
    assert resp.json() == {"online": False}


def test_nearest_color_name_matches_obvious_colors():
    assert nearest_color_name("#000000") == "Black"
    assert nearest_color_name("#FFFFFF") == "Jade White"  # Bambu's exact name for white
    assert nearest_color_name("#FF0000") == "Red"
    # Not one of Bambu's catalog hexes, so this falls through to the
    # generic nearest-match table instead of an exact lookup.
    assert nearest_color_name("#00FF00") == "Green"


def test_nearest_color_name_uses_exact_bambu_overrides():
    # These muted tones land on the wrong generic name (e.g. "Gray") under
    # plain RGB-distance matching; confirmed against real AMS-loaded colors.
    assert nearest_color_name("#68724D") == "Dark Green"
    assert nearest_color_name("#E8DBB7") == "Desert Tan"
    assert nearest_color_name("#00AE42") == "Bambu Green"
    assert nearest_color_name("#7D6556") == "Dark Brown"


def test_sync_ams_to_inventory_adds_new_trays_and_skips_known_ones(session):
    session.add(FilamentSpool(material="PLA", color_name="Red", color_hex="#ff0000"))
    session.commit()

    sync_ams_to_inventory(
        session,
        [
            {"material": "PLA", "color_hex": "#ff0000"},  # already tracked
            {"material": "PETG", "color_hex": "#000000"},  # new
        ],
    )

    spools = session.exec(select(FilamentSpool)).all()
    assert len(spools) == 2
    added = next(s for s in spools if s.material == "PETG")
    assert added.color_hex == "#000000"
    assert added.color_name == "Black"
    assert added.notes == "Auto-added from printer AMS"


def test_sync_ams_to_inventory_is_idempotent_across_calls(session):
    sync_ams_to_inventory(session, [{"material": "PLA", "color_hex": "#ff0000"}])
    sync_ams_to_inventory(session, [{"material": "PLA", "color_hex": "#ff0000"}])

    assert len(session.exec(select(FilamentSpool)).all()) == 1


def test_status_endpoint_auto_adds_loaded_filament_to_inventory(client, session, monkeypatch):
    monkeypatch.setenv("BAMBU_PRINTER_IP", "192.168.1.50")
    monkeypatch.setenv("BAMBU_SERIAL", "ABC123")
    monkeypatch.setenv("BAMBU_ACCESS_CODE", "secret")
    monkeypatch.setattr(
        printer_module,
        "fetch_report",
        lambda timeout=3.0: {
            "print": {
                "gcode_state": "RUNNING",
                "ams": {"ams": [{"tray": [{"tray_type": "PLA", "tray_color": "00FF00FF"}]}]},
            }
        },
    )
    reset_cache()

    resp = client.get("/api/printer/status")

    reset_cache()
    assert resp.status_code == 200
    spools = session.exec(select(FilamentSpool)).all()
    assert len(spools) == 1
    assert spools[0].material == "PLA"
    assert spools[0].color_hex == "#00FF00"
    assert spools[0].color_name == "Green"


def test_camera_auth_packet_has_expected_shape():
    packet = _camera_auth_packet("12345678")

    assert len(packet) == 80  # 4 header words + 32-byte username + 32-byte access code
    assert packet[:16] == struct.pack("<IIII", 0x40, 0x3000, 0, 0)
    assert packet[16:48] == b"bblp".ljust(32, b"\x00")
    assert packet[48:80] == b"12345678".ljust(32, b"\x00")


def test_read_frames_yields_each_jpeg_payload_in_order():
    stream = _framed(b"frame-one") + _framed(b"frame-two")
    sock = FakeCameraSocket(stream)

    frames = list(read_frames(sock))

    assert frames == [b"frame-one", b"frame-two"]


def test_read_frames_stops_cleanly_on_a_truncated_connection():
    # A header promising more payload than actually arrives, e.g. the
    # printer dropping the connection mid-frame.
    sock = FakeCameraSocket(struct.pack("<I", 1000) + b"\x00" * 12 + b"short")

    assert list(read_frames(sock)) == []
