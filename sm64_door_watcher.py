#!/usr/bin/env python3
"""
SM64 Door Watcher — RetroArch Memory Polling → MQTT → Node-RED → HA Green

Watches Super Mario 64 (US) running in RetroArch for a specific door being
opened, then fires an MQTT message to Node-RED (on Home Assistant Green),
which triggers an automation to release a mag lock on a real physical door.

Same chain as the HTML maze game, just swapping the browser for RetroArch:
  RetroArch (SM64) → this script → MQTT → Node-RED → HA action → mag lock off

USAGE:
  1. Enable RetroArch network commands:
     Settings → Network → Network Commands → ON (port 55355)

  2. Calibration mode — find your target door's coordinates:
       python3 sm64_door_watcher.py --calibrate
     Walk Mario through doors and note the position printed.

  3. Live mode — watch for the specific door and fire MQTT:
       python3 sm64_door_watcher.py

SM64 US RAM addresses (from n64decomp/sm64):
  Mario struct base:  0x8033B170  →  RDRAM 0x33B170
  Action  (+0x0C):    RDRAM 0x33B17C   (u32 big-endian)
  Pos X   (+0x3C):    RDRAM 0x33B1AC   (f32 big-endian)
  Pos Y   (+0x40):    RDRAM 0x33B1B0   (f32 big-endian)
  Pos Z   (+0x44):    RDRAM 0x33B1B4   (f32 big-endian)
  Level   (gCurrLevelNum): RDRAM 0x32DDF4 (s16 big-endian)

Door actions:
  ACT_PUSHING_DOOR = 0x00001320
  ACT_PULLING_DOOR = 0x00001321
"""

import socket
import struct
import time
import json
import argparse
import sys

# ---------------------------------------------------------------------------
# Configuration — edit these to match your setup
# ---------------------------------------------------------------------------

# RetroArch network command interface (UDP)
RETROARCH_HOST = "127.0.0.1"
RETROARCH_PORT = 55355

# MQTT broker on Home Assistant Green (same setup as the HTML maze game)
MQTT_HOST = "homeassistant.local"
MQTT_PORT = 1883
MQTT_TOPIC = "roomgame/door"
MQTT_USERNAME = "mqtt_user"
MQTT_PASSWORD = "ColdCase630!"
MQTT_PAYLOAD = json.dumps({"event": "doorsopen_plug_off"})

# SM64 US RAM addresses (RDRAM offsets, no 0x80000000 base)
ADDR_ACTION = 0x33B17C       # Mario's current action (4 bytes)
ADDR_POS_X  = 0x33B1AC       # Mario's X position (4-byte float)
ADDR_POS_Y  = 0x33B1B0       # Mario's Y position (4-byte float)
ADDR_POS_Z  = 0x33B1B4       # Mario's Z position (4-byte float)
ADDR_LEVEL  = 0x32DDF4       # gCurrLevelNum (2 bytes)

# Door action constants from SM64 decomp
ACT_PUSHING_DOOR = 0x00001320
ACT_PULLING_DOOR = 0x00001321
DOOR_ACTIONS = {ACT_PUSHING_DOOR, ACT_PULLING_DOOR}

# Target: Castle Inside
LEVEL_CASTLE = 6

# Target door position — Bob-omb Battlefield door (ground floor, left side)
# ** RUN WITH --calibrate FIRST to get exact coordinates for your ROM **
# These are approximate; update after calibration.
TARGET_DOOR_X = -1100.0
TARGET_DOOR_Y = 0.0
TARGET_DOOR_Z = 300.0
TARGET_DOOR_RADIUS = 400.0   # position tolerance (SM64 world units)

# Polling interval (seconds)
POLL_INTERVAL = 0.05  # 50ms = 20 checks/sec

# Cooldown after firing (seconds) — prevent duplicate triggers
FIRE_COOLDOWN = 10.0

# ---------------------------------------------------------------------------
# RetroArch UDP memory reader
# ---------------------------------------------------------------------------

class RetroArchReader:
    """Reads N64 RDRAM via RetroArch's UDP network command interface."""

    def __init__(self, host=RETROARCH_HOST, port=RETROARCH_PORT, timeout=0.5):
        self.addr = (host, port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)

    def read_bytes(self, rdram_offset, num_bytes):
        """Send READ_CORE_RAM and return raw bytes, or None on failure."""
        cmd = f"READ_CORE_RAM {rdram_offset:x} {num_bytes}\n"
        try:
            self.sock.sendto(cmd.encode(), self.addr)
            data, _ = self.sock.recvfrom(4096)
        except socket.timeout:
            return None
        except OSError:
            return None

        # Response format: "READ_CORE_RAM <addr> <byte1> <byte2> ...\n"
        # Bytes are hex-encoded, space-separated.
        text = data.decode("ascii", errors="replace").strip()
        parts = text.split()
        if len(parts) < 3 or parts[0] != "READ_CORE_RAM":
            return None

        hex_bytes = parts[2:]  # skip command name and address echo
        if len(hex_bytes) < num_bytes:
            return None

        try:
            return bytes(int(b, 16) for b in hex_bytes[:num_bytes])
        except ValueError:
            return None

    def read_u32(self, rdram_offset):
        """Read a big-endian uint32 from RDRAM."""
        raw = self.read_bytes(rdram_offset, 4)
        if raw is None:
            return None
        return struct.unpack(">I", raw)[0]

    def read_f32(self, rdram_offset):
        """Read a big-endian float32 from RDRAM."""
        raw = self.read_bytes(rdram_offset, 4)
        if raw is None:
            return None
        return struct.unpack(">f", raw)[0]

    def read_s16(self, rdram_offset):
        """Read a big-endian int16 from RDRAM."""
        raw = self.read_bytes(rdram_offset, 2)
        if raw is None:
            return None
        return struct.unpack(">h", raw)[0]

    def close(self):
        self.sock.close()


# ---------------------------------------------------------------------------
# MQTT publisher (minimal, no dependency on paho — just raw TCP)
# ---------------------------------------------------------------------------

class MqttPublisher:
    """
    Minimal MQTT 3.1.1 publisher.  Connects, publishes one message, done.
    No external dependency (no paho needed).
    """

    def __init__(self, host, port, username=None, password=None):
        self.host = host
        self.port = port
        self.username = username
        self.password = password

    def _encode_utf8(self, s):
        encoded = s.encode("utf-8")
        return struct.pack(">H", len(encoded)) + encoded

    def _build_connect(self, client_id="sm64_door_watcher"):
        # Variable header
        protocol_name = self._encode_utf8("MQTT")
        protocol_level = b"\x04"  # 3.1.1

        connect_flags = 0x02  # clean session
        if self.username:
            connect_flags |= 0x80
        if self.password:
            connect_flags |= 0x40

        keep_alive = struct.pack(">H", 60)

        var_header = protocol_name + protocol_level + bytes([connect_flags]) + keep_alive

        # Payload
        payload = self._encode_utf8(client_id)
        if self.username:
            payload += self._encode_utf8(self.username)
        if self.password:
            payload += self._encode_utf8(self.password)

        remaining = var_header + payload
        return self._packet(0x10, remaining)

    def _build_publish(self, topic, message, qos=0):
        var_header = self._encode_utf8(topic)
        payload = message.encode("utf-8") if isinstance(message, str) else message
        return self._packet(0x30, var_header + payload)

    def _packet(self, pkt_type, remaining):
        length = len(remaining)
        header = bytes([pkt_type])
        # Encode remaining length (MQTT variable-length encoding)
        len_bytes = b""
        while True:
            byte = length % 128
            length = length // 128
            if length > 0:
                byte |= 0x80
            len_bytes += bytes([byte])
            if length == 0:
                break
        return header + len_bytes + remaining

    def publish(self, topic, message):
        """Connect, publish, disconnect. Returns True on success."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5.0)
            sock.connect((self.host, self.port))

            # CONNECT
            sock.sendall(self._build_connect())
            connack = sock.recv(4)
            if len(connack) < 4 or connack[3] != 0:
                print(f"  [MQTT] CONNACK failed: {connack.hex()}")
                sock.close()
                return False

            # PUBLISH
            sock.sendall(self._build_publish(topic, message))

            # DISCONNECT
            sock.sendall(bytes([0xE0, 0x00]))
            sock.close()
            return True
        except Exception as e:
            print(f"  [MQTT] Error: {e}")
            return False


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def distance(x1, y1, z1, x2, y2, z2):
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2) ** 0.5


def calibrate(reader):
    """
    Calibration mode: poll continuously and print Mario's position
    whenever a door-opening action is detected.
    Walk through every door you want to identify.
    """
    print("=" * 60)
    print("  SM64 DOOR CALIBRATION MODE")
    print("=" * 60)
    print("  Walk Mario through doors in the castle.")
    print("  When a door action is detected, position is printed.")
    print("  Use those coordinates to set TARGET_DOOR_* in the script.")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)
    print()

    prev_action = None

    while True:
        action = reader.read_u32(ADDR_ACTION)
        if action is None:
            print("  [!] Can't read RetroArch. Is the game running with network commands ON?")
            time.sleep(2.0)
            continue

        # Detect transition INTO a door action
        if action in DOOR_ACTIONS and prev_action not in DOOR_ACTIONS:
            x = reader.read_f32(ADDR_POS_X)
            y = reader.read_f32(ADDR_POS_Y)
            z = reader.read_f32(ADDR_POS_Z)
            level = reader.read_s16(ADDR_LEVEL)

            action_name = "PUSHING" if action == ACT_PUSHING_DOOR else "PULLING"

            print(f"  DOOR {action_name}!")
            print(f"    Level : {level}")
            print(f"    Pos X : {x:.1f}")
            print(f"    Pos Y : {y:.1f}")
            print(f"    Pos Z : {z:.1f}")
            print(f"    ---")
            print(f"    To use this door, set in the script:")
            print(f"      TARGET_DOOR_X = {x:.1f}")
            print(f"      TARGET_DOOR_Y = {y:.1f}")
            print(f"      TARGET_DOOR_Z = {z:.1f}")
            print(f"      LEVEL_CASTLE  = {level}")
            print()

        prev_action = action
        time.sleep(POLL_INTERVAL)


def watch(reader, mqtt):
    """
    Live mode: poll for the target door being opened,
    then fire the MQTT message to Node-RED.
    """
    print("=" * 60)
    print("  SM64 DOOR WATCHER — LIVE MODE")
    print("=" * 60)
    print(f"  RetroArch : {RETROARCH_HOST}:{RETROARCH_PORT}")
    print(f"  MQTT      : {MQTT_HOST}:{MQTT_PORT}")
    print(f"  Topic     : {MQTT_TOPIC}")
    print(f"  Target    : Level {LEVEL_CASTLE}, "
          f"pos ({TARGET_DOOR_X:.0f}, {TARGET_DOOR_Y:.0f}, {TARGET_DOOR_Z:.0f}) "
          f"± {TARGET_DOOR_RADIUS:.0f}")
    print()
    print("  Waiting for Mario to open the target door...")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)
    print()

    prev_action = None
    last_fire_time = 0

    while True:
        action = reader.read_u32(ADDR_ACTION)
        if action is None:
            time.sleep(1.0)
            continue

        # Detect transition INTO a door action
        if action in DOOR_ACTIONS and prev_action not in DOOR_ACTIONS:
            level = reader.read_s16(ADDR_LEVEL)
            x = reader.read_f32(ADDR_POS_X)
            y = reader.read_f32(ADDR_POS_Y)
            z = reader.read_f32(ADDR_POS_Z)

            action_name = "PUSHING" if action == ACT_PUSHING_DOOR else "PULLING"
            print(f"  Door {action_name} detected at level={level} "
                  f"pos=({x:.0f}, {y:.0f}, {z:.0f})")

            # Check if this is the target door
            if level == LEVEL_CASTLE:
                dist = distance(x, y, z,
                                TARGET_DOOR_X, TARGET_DOOR_Y, TARGET_DOOR_Z)
                if dist <= TARGET_DOOR_RADIUS:
                    now = time.time()
                    if now - last_fire_time >= FIRE_COOLDOWN:
                        print()
                        print("  *** TARGET DOOR OPENED! ***")
                        print(f"  Distance from target: {dist:.1f} units")
                        print(f"  Firing MQTT → {MQTT_TOPIC}")

                        ok = mqtt.publish(MQTT_TOPIC, MQTT_PAYLOAD)
                        if ok:
                            print("  MQTT published! Physical door should open.")
                        else:
                            print("  MQTT publish FAILED. Check HA Green connection.")
                        print()

                        last_fire_time = now
                    else:
                        remaining = FIRE_COOLDOWN - (now - last_fire_time)
                        print(f"  (cooldown: {remaining:.0f}s remaining, skipping)")
                else:
                    print(f"  (not the target door — distance: {dist:.0f})")
            else:
                print(f"  (wrong level — expected {LEVEL_CASTLE})")

        prev_action = action
        time.sleep(POLL_INTERVAL)


def main():
    parser = argparse.ArgumentParser(
        description="SM64 Door Watcher — open a real door when Mario opens one in-game"
    )
    parser.add_argument(
        "--calibrate", action="store_true",
        help="Calibration mode: print Mario's position on every door open"
    )
    parser.add_argument(
        "--retroarch-host", default=RETROARCH_HOST,
        help=f"RetroArch host (default: {RETROARCH_HOST})"
    )
    parser.add_argument(
        "--retroarch-port", type=int, default=RETROARCH_PORT,
        help=f"RetroArch UDP port (default: {RETROARCH_PORT})"
    )
    parser.add_argument(
        "--mqtt-host", default=MQTT_HOST,
        help=f"MQTT broker host (default: {MQTT_HOST})"
    )
    parser.add_argument(
        "--mqtt-port", type=int, default=MQTT_PORT,
        help=f"MQTT broker port (default: {MQTT_PORT})"
    )
    args = parser.parse_args()

    reader = RetroArchReader(host=args.retroarch_host, port=args.retroarch_port)

    if args.calibrate:
        try:
            calibrate(reader)
        except KeyboardInterrupt:
            print("\n  Calibration stopped.")
    else:
        mqtt = MqttPublisher(
            host=args.mqtt_host,
            port=args.mqtt_port,
            username=MQTT_USERNAME,
            password=MQTT_PASSWORD,
        )
        try:
            watch(reader, mqtt)
        except KeyboardInterrupt:
            print("\n  Watcher stopped.")

    reader.close()


if __name__ == "__main__":
    main()
