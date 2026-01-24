from datetime import datetime
import json
import os
from pathlib import Path
import sys

from mtga import scryfall

if __name__ == "__main__":

    # Paths (mirrors prior config.paths defaults, inlined for standalone use)
    user = os.getenv("USER", "unknown")
    data_home = Path(f"/opt/{user}/dat")
    mtga_prefix = data_home / "mtga"
    scryfall_prefix = mtga_prefix / "scryfall"
    latest_key = scryfall_prefix / "all_cards.json"

    # Pull
    data = scryfall.get_latest_all_cards_data()

    # Ensure Directory
    cur_ts = datetime.now().strftime("%Y%m%d%H%M%S")
    path = scryfall_prefix / f"all_cards_{cur_ts}.json"
    path.parent.mkdir(parents=True, exist_ok=True)

    # Write
    try:
        parsed = json.loads(data.decode("utf-8"))
    except Exception as exc:
        raise ValueError("Failed to decode Scryfall data as JSON.") from exc
    with open(path, "w", encoding="utf-8") as f:
        json.dump(parsed, f, indent=4)
    print(f"Wrote {len(data)} bytes to {path}.")

    # Make Link
    if latest_key.exists() or latest_key.is_symlink():
        if latest_key.is_symlink():
            latest_key.unlink()
        else:
            print(f"Refusing to overwrite non-link at {latest_key}.", file=sys.stderr)
            sys.exit(1)
    latest_key.symlink_to(path)
    print(f"Linked {latest_key} to {path}.")
