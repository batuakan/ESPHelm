"""Compare an SDL screenshot with its golden image (used by e2e_sdl.ts).

Usage: python -I compare_images.py <actual.bmp> <golden.png> [--update]
Prints one JSON line: {"status": "match"|"differs"|"created", "changed": fraction, ...}.
A pixel counts as changed when any channel differs by more than TOLERANCE.
"""

import json
from pathlib import Path
import sys

from PIL import Image, ImageChops

TOLERANCE = 16
MAX_CHANGED_FRACTION = 0.002


def main() -> int:
    actual_path, golden_path = Path(sys.argv[1]), Path(sys.argv[2])
    update = "--update" in sys.argv[3:]
    actual = Image.open(actual_path).convert("RGB")
    png = actual_path.with_suffix(".png")
    actual.save(png)
    if update or not golden_path.exists():
        golden_path.parent.mkdir(parents=True, exist_ok=True)
        actual.save(golden_path)
        print(json.dumps({"status": "created", "golden": str(golden_path), "actual": str(png)}))
        return 0
    golden = Image.open(golden_path).convert("RGB")
    if golden.size != actual.size:
        print(json.dumps({"status": "differs", "reason": f"size {actual.size} != {golden.size}"}))
        return 1
    diff = ImageChops.difference(actual, golden)
    # Largest channel difference per pixel, then count pixels above the tolerance.
    r, g, b = diff.split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), b)
    changed = sum(worst.histogram()[TOLERANCE + 1 :])
    fraction = changed / (actual.size[0] * actual.size[1])
    ok = fraction <= MAX_CHANGED_FRACTION
    print(json.dumps({"status": "match" if ok else "differs", "changed": round(fraction, 5), "actual": str(png)}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
