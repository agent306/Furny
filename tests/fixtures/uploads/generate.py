"""Regenerates the upload fixtures next to this file (13 §11, §20.12).

    uv run --with pillow python tests/fixtures/uploads/generate.py

Deterministic: no random numbers, no timestamps, so a second run writes identical bytes (with the same Pillow
and libjpeg/libwebp build). The outputs are committed; the tests read them and never run this script.
"""

import struct
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent


def write(name: str, data: bytes) -> None:
    (OUT / name).write_bytes(data)


def corner_image(width: int, height: int, mode: str = "RGB") -> Image.Image:
    """Four solid corner blocks on grey, so orientation is visible and survives lossy encoding."""
    alpha = 255 if mode == "RGBA" else None
    grey = (128, 128, 128) + ((alpha,) if alpha else ())
    image = Image.new(mode, (width, height), grey)
    draw = ImageDraw.Draw(image)
    block_w, block_h = width // 4, height // 4
    colours = {
        (0, 0): (255, 0, 0),
        (width - block_w, 0): (0, 255, 0),
        (0, height - block_h): (0, 0, 255),
        (width - block_w, height - block_h): (255, 255, 0),
    }
    for (x, y), colour in colours.items():
        draw.rectangle((x, y, x + block_w - 1, y + block_h - 1), fill=colour + ((alpha,) if alpha else ()))
    return image


def exif_gps_rotated() -> bytes:
    """400 x 300 stored pixels, EXIF orientation 6 (shown 300 x 400), GPS latitude and longitude."""
    import io

    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90 clockwise to display
    exif[0x010F] = "Furny Test Camera"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (12.0, 58.0, 30.0)
    gps[3] = "E"
    gps[4] = (77.0, 35.0, 15.0)
    buffer = io.BytesIO()
    corner_image(400, 300).save(buffer, "JPEG", quality=90, exif=exif.tobytes())
    return buffer.getvalue()


def plain_png() -> bytes:
    import io

    image = corner_image(64, 48, "RGBA")
    # Left half of the middle band fully transparent: alpha must survive the re-encode.
    ImageDraw.Draw(image).rectangle((20, 16, 43, 31), fill=(0, 0, 0, 0))
    buffer = io.BytesIO()
    image.save(buffer, "PNG", compress_level=6)
    return buffer.getvalue()


def plain_webp() -> bytes:
    import io

    buffer = io.BytesIO()
    corner_image(64, 48).save(buffer, "WEBP", quality=80, method=4)
    return buffer.getvalue()


def animated_webp() -> bytes:
    import io

    first = corner_image(32, 32)
    second = Image.new("RGB", (32, 32), (10, 200, 240))
    buffer = io.BytesIO()
    first.save(buffer, "WEBP", save_all=True, append_images=[second], duration=100, loop=0, lossless=True)
    return buffer.getvalue()


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def bomb_png(width: int = 8000, height: int = 6250) -> bytes:
    """A valid-looking PNG header that announces 50 megapixels, with a few bytes of pixel data."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(b"\x00" * 16, 9))
        + png_chunk(b"IEND", b"")
    )


def minimal_pdf() -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
        b"<< /Length 0 >>\nstream\n\nendstream",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def ascii_dxf() -> bytes:
    lines = [
        "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES",
        "0", "LINE", "8", "WALLS", "10", "0.0", "20", "0.0", "30", "0.0", "11", "4000.0", "21", "0.0", "31", "0.0",
        "0", "ENDSEC", "0", "EOF",
    ]
    return ("\r\n".join(f"{line:>3}" if line.isdigit() else line for line in lines) + "\r\n").encode()


def binary_dxf() -> bytes:
    return b"AutoCAD Binary DXF\r\n\x1a\x00" + b"\x00SECTION\x00\x02HEADER\x00" + b"\x00" * 32


def dwg_header() -> bytes:
    """A DWG R2018 file starts with the ASCII version `AC1032` followed by zero bytes."""
    return b"AC1032" + b"\x00" * 5 + b"\x01" + b"\x00" * 120


def minimal_heic() -> bytes:
    """An `ftyp` box of brand `heic` and nothing else: enough for sniffing, not a decodable image."""
    return struct.pack(">I", 24) + b"ftypheic" + b"\x00\x00\x00\x00" + b"mif1heic" + b"\x00" * 64


def vector_svg() -> bytes:
    return (
        b'<?xml version="1.0" encoding="UTF-8"?>\n'
        b'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48">'
        b'<script>alert(1)</script><rect width="64" height="48" fill="#c00"/></svg>\n'
    )


def png_as_jpg() -> bytes:
    return plain_png()


def main() -> None:
    write("exif-gps-rotated.jpg", exif_gps_rotated())
    write("plain.png", plain_png())
    write("plain.webp", plain_webp())
    write("animated.webp", animated_webp())
    write("png-as-jpg.jpg", png_as_jpg())
    write("doc.pdf", minimal_pdf())
    write("plan.dxf", ascii_dxf())
    write("binary.dxf", binary_dxf())
    write("drawing-as-dxf.dxf", dwg_header())
    write("vector.svg", vector_svg())
    write("bomb-50mp.png", bomb_png())
    write("minimal.heic", minimal_heic())


if __name__ == "__main__":
    main()
