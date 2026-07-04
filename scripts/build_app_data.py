import argparse
from datetime import date
import gzip
from html import escape
import json
import os
from pathlib import Path

import pandas as pd

# Historical floor for the app. Default builds union this list with released
# Scryfall expansion sets so the registry grows automatically over time.
BASE_SET_CODES = [
    "MH2",
    "NEO",
    "SNC",
    "DMU",
    "BRO",
    "ONE",
    "MOM",
    "LTR",
    "WOE",
    "LCI",
    "MKM",
    "OTJ",
    "MH3",
    "BLB",
    "DSK",
    "FDN",
    "DFT",
    "TDM",
    "FIN",
    "EOE",
    "SPM",
    "TLA",
    "TMT",
]
AUTO_SET_TYPES = {"expansion"}
DATA_SCHEMA_VERSION = 4
SET_FIELDS = [
    "id",
    "name",
    "collectorNumber",
    "colors",
    "manaCost",
    "typeLine",
    "rarity",
    "priceUsd",
    "priceUsdFoil",
    "priceUsdEtched",
    "valueHint",
    "imageSmallUrl",
    "imageNormalUrl",
]
THUMBNAIL_CACHE_MIN_COVERAGE = 0.85


def create_parser():
    desc = "Build lazy-load app/data JSON files from processed parquet files"
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument("--sets", nargs="*", help="Set codes to include.")
    return parser


def read_with_error(fpath):
    if not fpath.exists():
        raise FileNotFoundError(f"File not found: {fpath}")
    else:
        return pd.read_parquet(fpath)


def clean_value(value):
    if pd.isna(value):
        return None
    return value


def clean_text(value):
    value = clean_value(value)
    return "" if value is None else value


def clean_price(value):
    value = clean_value(value)
    return None if value is None else float(value)


def dedupe_preserving_order(values):
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def resolve_default_set_codes(cards_df, sets_df):
    card_set_codes = set(cards_df["set"].dropna().str.upper().unique())
    baseline = [code for code in BASE_SET_CODES if code in card_set_codes]
    union = set(baseline)

    sets_with_dates = sets_df.copy()
    sets_with_dates["released_at"] = pd.to_datetime(
        sets_with_dates["released_at"], errors="coerce"
    )
    baseline_dates = sets_with_dates[
        sets_with_dates["set"].isin(baseline)
    ]["released_at"].dropna()
    min_release_date = baseline_dates.min() if not baseline_dates.empty else None

    if "set_type" in sets_with_dates.columns:
        today = pd.Timestamp(date.today())
        auto_mask = (
            sets_with_dates["set"].isin(card_set_codes)
            & sets_with_dates["set_type"].isin(AUTO_SET_TYPES)
            & sets_with_dates["released_at"].notna()
            & (sets_with_dates["released_at"] <= today)
        )
        # Digital-only (Arena/Alchemy) sets exist in the parquet for the
        # draft models but never belong in the paper-inventory dropdown.
        if "digital" in sets_with_dates.columns:
            auto_mask &= ~sets_with_dates["digital"].fillna(False)
        if min_release_date is not None:
            auto_mask &= sets_with_dates["released_at"] >= min_release_date
        auto_sets = sets_with_dates[auto_mask]["set"].tolist()
        union.update(auto_sets)

    baseline_rank = {code: index for index, code in enumerate(BASE_SET_CODES)}
    ordered_sets = sets_with_dates[sets_with_dates["set"].isin(union)].copy()
    ordered_sets["baseline_rank"] = (
        ordered_sets["set"].map(baseline_rank).fillna(len(BASE_SET_CODES)).astype(int)
    )
    ordered_sets = ordered_sets.sort_values(
        ["released_at", "baseline_rank", "set"],
        na_position="first",
    )
    return ordered_sets["set"].tolist()


def resolve_default_set_code(set_codes, sets_df):
    sets_with_dates = sets_df[sets_df["set"].isin(set_codes)].copy()
    sets_with_dates["released_at"] = pd.to_datetime(
        sets_with_dates["released_at"], errors="coerce"
    )
    sets_with_dates = sets_with_dates.sort_values(
        ["released_at", "set"],
        na_position="first",
    )
    if sets_with_dates.empty:
        return set_codes[-1]
    return sets_with_dates.iloc[-1]["set"]


def resolve_build_id(paths):
    latest_mtime = max(path.stat().st_mtime for path in paths)
    return f"v{DATA_SCHEMA_VERSION}-{int(latest_mtime)}"


def write_json(path, payload, *, indent=None):
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=indent, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    write_gzip_copy(path)


def write_gzip_copy(path):
    gz_path = path.with_suffix(path.suffix + ".gz")
    gz_path.write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def write_bootstrap(path, manifest, default_set_payload):
    bootstrap = {
        "schemaVersion": DATA_SCHEMA_VERSION,
        "manifest": manifest,
        "defaultSet": default_set_payload,
    }
    with path.open("w", encoding="utf-8") as f:
        f.write("window.MTG_REGISTRY_BOOTSTRAP=")
        json.dump(bootstrap, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    write_gzip_copy(path)


def write_initial_index(path, template_path, manifest, default_set_payload):
    html = template_path.read_text(encoding="utf-8")
    default_set_code = default_set_payload["setCode"]
    set_meta = next(
        (item for item in manifest["sets"] if item["setCode"] == default_set_code),
        {"setCode": default_set_code, "setName": default_set_code},
    )
    cards = [dict(zip(default_set_payload["fields"], row)) for row in default_set_payload["cards"]]
    cards = sorted(
        cards,
        key=lambda card: collector_sort_key(card.get("collectorNumber")),
    )
    first_card = cards[0]
    set_label = f"{set_meta['setName']} ({default_set_code})"
    type_parts = split_type_line(first_card.get("typeLine"))
    image_url = initial_image_url(first_card, manifest, default_set_code)

    replacements = {
        '<select id="setSelect"></select>': render_set_select(manifest),
        '<span id="setBadge" class="chip"></span>': (
            f'<span id="setBadge" class="chip">{escape(set_label)}</span>'
        ),
        '<span id="rarityBadge" class="chip"></span>': (
            f'<span id="rarityBadge" class="chip">{escape(first_card.get("rarity") or "")}</span>'
        ),
        '<span id="position" class="position"></span>': (
            f'<span id="position" class="position">1 / {len(cards)}</span>'
        ),
        '<div class="card-title" id="cardName"></div>': (
            f'<div class="card-title" id="cardName">{escape(first_card["name"])}</div>'
        ),
        '<div class="flavor" id="flavorText">-</div>': (
            '<div class="flavor" id="flavorText">-</div>'
        ),
        '<span class="fact-value" id="metaName"></span>': (
            f'<span class="fact-value" id="metaName">{escape(first_card["name"])}</span>'
        ),
        '<span class="fact-value" id="metaNumber"></span>': (
            f'<span class="fact-value" id="metaNumber">#{escape(str(first_card["collectorNumber"]))}</span>'
        ),
        '<span class="fact-value" id="metaColor"></span>': (
            f'<span class="fact-value" id="metaColor">{escape(display_colors(first_card.get("colors") or []))}</span>'
        ),
        '<span class="fact-value" id="metaMana"></span>': (
            f'<span class="fact-value" id="metaMana">{escape(first_card.get("manaCost") or "-")}</span>'
        ),
        '<span class="fact-value" id="metaType"></span>': (
            f'<span class="fact-value" id="metaType">{escape(type_parts[0] or "-")}</span>'
        ),
        '<span class="fact-value" id="metaSubtype"></span>': (
            f'<span class="fact-value" id="metaSubtype">{escape(type_parts[1] or "-")}</span>'
        ),
        '<span class="price-value" id="priceUsd">—</span>': (
            f'<span class="price-value" id="priceUsd">{escape(format_price(first_card.get("priceUsd")))}</span>'
        ),
        '<span class="price-value" id="priceFoil">—</span>': (
            f'<span class="price-value" id="priceFoil">{escape(format_price(first_card.get("priceUsdFoil")))}</span>'
        ),
        '<span class="price-value" id="priceEtched">—</span>': (
            f'<span class="price-value" id="priceEtched">{escape(format_price(first_card.get("priceUsdEtched")))}</span>'
        ),
        '<div class="price-hint" id="valueHint"></div>': (
            f'<div class="price-hint" id="valueHint">{escape(first_card.get("valueHint") or "")}</div>'
        ),
        '<img id="cardImage" alt="Card art" loading="eager" decoding="async" fetchpriority="high" />': (
            f'<img id="cardImage" alt="{escape(first_card["name"])} card image" '
            f'loading="eager" decoding="async" fetchpriority="high" src="{escape(image_url)}" />'
        ),
        '<div id="noImage" class="no-image">No image available</div>': (
            '<div id="noImage" class="no-image" style="display:none">No image available</div>'
        ),
    }

    for old, new in replacements.items():
        html = html.replace(old, new)

    path.write_text(html, encoding="utf-8")


def render_set_select(manifest):
    options = []
    default_set_code = manifest.get("defaultSetCode")
    for set_meta in manifest.get("sets", []):
        set_code = set_meta["setCode"]
        selected = " selected" if set_code == default_set_code else ""
        label = f"{set_meta.get('setName') or set_code} ({set_code})"
        options.append(
            f'<option value="{escape(set_code)}"{selected}>{escape(label)}</option>'
        )
    return '<select id="setSelect">' + "".join(options) + "</select>"


def collector_sort_key(value):
    text = str(value or "")
    try:
        return (0, int(text), text)
    except ValueError:
        return (1, 0, text)


def split_type_line(value):
    parts = [part.strip() for part in str(value or "").split("—") if part.strip()]
    if len(parts) >= 2:
        return parts[0], " — ".join(parts[1:])
    return str(value or ""), ""


def display_colors(colors):
    if not colors:
        return "Colorless"
    if len(colors) > 1:
        return "Multicolor"
    return {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"}.get(
        colors[0], ", ".join(colors)
    )


def format_price(value):
    if value is None or value == "":
        return "-"
    return f"${float(value):.2f}"


def initial_image_url(card, manifest, set_code):
    thumbnail_sets = set(manifest.get("thumbnailSetCodes") or [])
    thumbnail_path = manifest.get("thumbnailCachePath")
    if thumbnail_path and set_code in thumbnail_sets:
        return f"data/{thumbnail_path}/{card['id']}.jpg"
    return card.get("imageSmallUrl") or card.get("imageNormalUrl") or ""


def compact_card_row(card, colors, value_hint):
    image_normal_url = clean_value(card.get("image_normal_url"))
    legacy_image_url = clean_value(card.get("image_url"))
    image_normal_url = image_normal_url or legacy_image_url
    image_small_url = clean_value(card.get("image_small_url")) or image_normal_url

    values = {
        "id": card["id"],
        "name": card["name"],
        "collectorNumber": card["collector_number"],
        "colors": colors,
        "manaCost": clean_text(card["mana_cost"]),
        "typeLine": clean_text(card["type_line"]),
        "rarity": clean_text(card["rarity"]),
        "priceUsd": clean_price(card["price_usd"]),
        "priceUsdFoil": clean_price(card["price_usd_foil"]),
        "priceUsdEtched": clean_price(card["price_usd_etched"]),
        "valueHint": value_hint,
        "imageSmallUrl": image_small_url,
        "imageNormalUrl": image_normal_url,
    }
    return [values[field] for field in SET_FIELDS]


def resolve_thumbnail_cache_metadata(output_dir, app_sets):
    images_dir = output_dir / "images"
    if not images_dir.is_dir():
        return None, []

    id_index = SET_FIELDS.index("id")
    image_small_index = SET_FIELDS.index("imageSmallUrl")
    image_normal_index = SET_FIELDS.index("imageNormalUrl")
    thumbnail_set_codes = []
    for set_code, card_rows in app_sets.items():
        image_rows = [
            row for row in card_rows if row[image_small_index] or row[image_normal_index]
        ]
        if not image_rows:
            continue
        available_count = sum(
            (images_dir / f"{row[id_index]}.jpg").is_file()
            and (images_dir / f"{row[id_index]}.jpg").stat().st_size > 0
            for row in image_rows
        )
        coverage = available_count / len(image_rows)
        if coverage >= THUMBNAIL_CACHE_MIN_COVERAGE:
            thumbnail_set_codes.append(set_code)

    if not thumbnail_set_codes:
        return None, []
    return "images", thumbnail_set_codes


if __name__ == "__main__":

    # Parser -> args -> unpack args
    parser = create_parser()
    args = parser.parse_args()

    # Determine paths
    user = os.getenv("USER", "unknown")
    processed_prefix = Path(f"/opt/{user}/dat/mtga/processed")
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    output_dir = repo_root / "app" / "data"
    manifest_path = output_dir / "manifest.json"
    bootstrap_path = output_dir / "bootstrap.js"
    index_path = output_dir / "index.html"
    index_template_path = repo_root / "app" / "index.html"
    sets_dir = output_dir / "sets"

    # Read Cards
    cards_path = processed_prefix / "cards.parquet"
    cards_df = read_with_error(cards_path)
    cards_df["set"] = cards_df["set"].str.upper()

    # Read Sets
    sets_path = processed_prefix / "sets.parquet"
    sets_df = read_with_error(sets_path)
    sets_df["set"] = sets_df["set"].str.upper()
    if args.sets:
        set_codes = dedupe_preserving_order([s.upper() for s in args.sets])
    else:
        set_codes = resolve_default_set_codes(cards_df, sets_df)
    print(f"Building app data for sets: {', '.join(set_codes)}")

    cards_df = cards_df[cards_df["set"].isin(set_codes)]
    sets_df = sets_df[sets_df["set"].isin(set_codes)]

    # Check
    if cards_df.empty or sets_df.empty:
        raise ValueError("Got 0 data to write for application.")

    # Convert to app format, split by set for lazy loading.
    app_sets = {set_code: [] for set_code in set_codes}
    for _, card in cards_df.iterrows():
        # Parse colors (comma-separated string to array)
        colors = (
            card["colors"].split(",")
            if pd.notna(card["colors"]) and card["colors"]
            else []
        )

        # Create value hint from price
        value_hint = None
        if pd.notna(card.get("price_best")) and card["price_best"] > 0:
            value_hint = f"${card['price_best']:.2f}"

        app_sets[card["set"]].append(compact_card_row(card, colors, value_hint))

    thumbnail_cache_path, thumbnail_set_codes = resolve_thumbnail_cache_metadata(
        output_dir, app_sets
    )

    # Write compact JSON for the web app.
    output_dir.mkdir(parents=True, exist_ok=True)
    sets_dir.mkdir(parents=True, exist_ok=True)
    for stale_path in list(sets_dir.glob("*.json")) + list(sets_dir.glob("*.json.gz")):
        stale_path.unlink()

    old_cards_path = output_dir / "cards.js"
    if old_cards_path.exists():
        old_cards_path.unlink()
    for stale_path in (bootstrap_path, bootstrap_path.with_suffix(".js.gz")):
        if stale_path.exists():
            stale_path.unlink()
    if index_path.exists():
        index_path.unlink()

    manifest_sets = []
    set_payloads = {}
    total_cards = 0
    for set_code in set_codes:
        set_cards = app_sets[set_code]
        set_path = sets_dir / f"{set_code}.json"
        set_payload = {
            "schemaVersion": DATA_SCHEMA_VERSION,
            "setCode": set_code,
            "fields": SET_FIELDS,
            "cards": set_cards,
        }
        set_payloads[set_code] = set_payload
        write_json(set_path, set_payload)

        set_rows = sets_df[sets_df["set"] == set_code]
        set_name = set_rows.iloc[0]["set_name"] if not set_rows.empty else set_code
        manifest_sets.append(
            {
                "setCode": set_code,
                "setName": set_name,
                "cardCount": len(set_cards),
                "cardsPath": f"sets/{set_code}.json",
            }
        )
        total_cards += len(set_cards)
        print(f"Wrote {len(set_cards):,} cards to {set_path}")

    default_set_code = resolve_default_set_code(set_codes, sets_df)
    manifest = {
        "schemaVersion": DATA_SCHEMA_VERSION,
        "buildId": resolve_build_id([cards_path, sets_path]),
        "defaultSetCode": default_set_code,
        "sets": manifest_sets,
    }
    if thumbnail_cache_path:
        manifest["thumbnailCachePath"] = thumbnail_cache_path
        manifest["thumbnailSetCodes"] = thumbnail_set_codes
    write_json(manifest_path, manifest, indent=2)
    write_bootstrap(bootstrap_path, manifest, set_payloads[default_set_code])
    write_initial_index(index_path, index_template_path, manifest, set_payloads[default_set_code])

    print(f"Wrote manifest for {len(manifest_sets):,} sets to {manifest_path}")
    print(f"Wrote default bootstrap payload to {bootstrap_path}")
    print(f"Wrote server-rendered startup page to {index_path}")
    print(f"Wrote gzip copies for manifest and set files.")
    print(f"Wrote {total_cards:,} cards across split set files.")
