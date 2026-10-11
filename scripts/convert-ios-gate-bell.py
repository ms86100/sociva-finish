"""Convert ios-config/gate_bell.mp3 to a Linear PCM CAF for iOS notification playback.

Apple's system sound facility accepts aiff, wav, or caf in Linear PCM, MA4,
uLaw, or aLaw. MP3 is not one of those formats. Android and in-app Web Audio
keep the MP3.

Requires the miniaudio package (bundles a decoder; ffmpeg is not required):
  python -m pip install miniaudio
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ios-config" / "gate_bell.mp3"
TARGET = ROOT / "ios-config" / "gate_bell.caf"
MAX_SECONDS = 30


def write_caf(path: Path, pcm: bytes, sample_rate: int, channels: int, bits: int) -> None:
    if bits != 16:
        raise SystemExit(f"expected 16-bit PCM, got {bits}")
    if channels < 1:
        raise SystemExit("expected at least one channel")
    bytes_per_packet = channels * (bits // 8)
    # CAF chunk headers are big-endian. Linear PCM samples are little-endian.
    little_endian = 1 << 1
    desc = struct.pack(
        ">d4sIIIII",
        float(sample_rate),
        b"lpcm",
        little_endian,
        bytes_per_packet,
        1,
        channels,
        bits,
    )
    if len(desc) != 32:
        raise SystemExit(f"CAF desc chunk must be 32 bytes, got {len(desc)}")
    data = struct.pack(">I", 0) + pcm
    file_header = b"caff" + struct.pack(">HH", 1, 0)
    desc_chunk = b"desc" + struct.pack(">q", len(desc)) + desc
    data_chunk = b"data" + struct.pack(">q", len(data)) + data
    path.write_bytes(file_header + desc_chunk + data_chunk)


def verify_caf(path: Path) -> float:
    blob = path.read_bytes()
    if blob[:4] != b"caff":
        raise SystemExit("CAF magic missing")
    version, flags = struct.unpack_from(">HH", blob, 4)
    if version != 1 or flags != 0:
        raise SystemExit(f"unexpected CAF header version={version} flags={flags}")
    offset = 8
    sample_rate = channels = bits = None
    audio_bytes = None
    while offset + 12 <= len(blob):
        chunk_type = blob[offset : offset + 4]
        chunk_size = struct.unpack_from(">q", blob, offset + 4)[0]
        payload = blob[offset + 12 : offset + 12 + chunk_size]
        if chunk_type == b"desc":
            sample_rate, fmt, format_flags, _bpp, frames_per_packet, channels, bits = struct.unpack(
                ">d4sIIIII", payload[:32]
            )
            if fmt != b"lpcm" or format_flags != (1 << 1) or frames_per_packet != 1:
                raise SystemExit(
                    f"not little-endian Linear PCM: fmt={fmt!r} flags={format_flags} fpp={frames_per_packet}"
                )
        elif chunk_type == b"data":
            audio_bytes = len(payload) - 4
        offset += 12 + chunk_size
    if sample_rate is None or audio_bytes is None or not channels or not bits:
        raise SystemExit("CAF is missing desc or data")
    seconds = audio_bytes / (sample_rate * channels * (bits // 8))
    if seconds >= MAX_SECONDS:
        raise SystemExit(f"CAF is {seconds:.2f}s, which is not under {MAX_SECONDS}s")
    print(
        f"wrote {path.name}: lpcm {bits}-bit {channels}ch {sample_rate:.0f}Hz "
        f"{seconds:.2f}s {path.stat().st_size} bytes"
    )
    return seconds


def main() -> None:
    try:
        import miniaudio
    except ImportError:
        raise SystemExit("Install miniaudio first: python -m pip install miniaudio")

    if not SOURCE.is_file():
        raise SystemExit(f"missing {SOURCE}")
    decoded = miniaudio.decode_file(str(SOURCE), output_format=miniaudio.SampleFormat.SIGNED16)
    pcm = decoded.samples.tobytes()
    write_caf(TARGET, pcm, decoded.sample_rate, decoded.nchannels, 16)
    verify_caf(TARGET)


if __name__ == "__main__":
    main()
