"""Hand-written minimal PDF generator for tests (no reportlab, no network).

Coordinates are top-left, in points; they are converted to PDF's bottom-left origin here.
"""

from dataclasses import dataclass, field

A4_PT = (595.3, 841.9)  # portrait
A3_PT = (841.9, 1190.6)


@dataclass
class PageSpec:
    width_pt: float
    height_pt: float
    # (x0, y0, x1, y1, line_width_pt): black stroked segment
    lines: list[tuple[float, float, float, float, float]] = field(default_factory=list)
    # (x, y, text, size_pt): Helvetica text; (x, y) is the left end of the baseline
    words: list[tuple[float, float, str, float]] = field(default_factory=list)
    # (x, y, w, h): black-filled rectangle with its top-left corner at (x, y)
    filled_rects: list[tuple[float, float, float, float]] = field(default_factory=list)


def _n(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".") or "0"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _content(page: PageSpec) -> bytes:
    h = page.height_pt
    ops: list[str] = ["0 G 0 g"]
    for x0, y0, x1, y1, width in page.lines:
        ops.append(f"{_n(width)} w {_n(x0)} {_n(h - y0)} m {_n(x1)} {_n(h - y1)} l S")
    for x, y, w, rh in page.filled_rects:
        ops.append(f"{_n(x)} {_n(h - y - rh)} {_n(w)} {_n(rh)} re f")
    for x, y, text, size in page.words:
        ops.append(f"BT /F1 {_n(size)} Tf {_n(x)} {_n(h - y)} Td ({_escape(text)}) Tj ET")
    return "\n".join(ops).encode("latin-1")


def make_pdf(pages: list[PageSpec]) -> bytes:
    """Serialise `pages` as a PDF 1.4 file with an xref table and the Helvetica standard font."""
    # Object numbers: 1 catalog, 2 page tree, 3 font, then (page, content) pairs.
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(len(pages)))
    bodies: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    for i, page in enumerate(pages):
        content = _content(page)
        bodies.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_n(page.width_pt)} {_n(page.height_pt)}] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>"
            ).encode()
        )
        bodies.append(f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream")

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for num, body in enumerate(bodies, start=1):
        offsets.append(len(out))
        out += f"{num} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(bodies) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(bodies) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)
