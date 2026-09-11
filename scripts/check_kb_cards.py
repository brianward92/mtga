#!/usr/bin/env python3
"""Validate the checked MTG rules and LCI format references."""
import argparse, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS, RULES, LCI = REPO / "docs", REPO / "docs/rules", REPO / "docs/formats/lci"
FILES = sorted([*RULES.glob("*.md"), *LCI.glob("*.md")])
SENTINEL = "<!-- procedure: declare-blockers -->"
ADJUDICATED = {"hidden cave", "hidden caves", "cat advisor", "human soldier", "merfolk scout", "vampire knight", "legendary creature", "create a treasure", "flash equipment", "gih in premier", "in limited", "quick draft", "lci quick draft", "the map", "the frog", "altar's reap", "a-geological appraiser", "deep king", "hidden cave for discover", "nameless city", "one or two hidden caves", "quicksand whirlpool exile"}
NAME = re.compile(r"\b([A-Z][A-Za-z'\-]+(?: (?:of|the|to|a|an|in|on|and|de|del|for)? ?[A-Z][A-Za-z'\-]+){1,4})\b")
CLAIM = (re.compile(r"\{[0-9WUBRGCX]"), re.compile(r"\((C|U|R|M)\)"))


def known_names(cards):
    names = set()
    for full, card in cards.items():
        for variant in {full, card.get("frontName") or full}:
            for part in variant.split(" // "):
                part = part.strip()
                names |= {part.lower(), part.lower() + "s", part.lower().rstrip("s"), part.lower().removeprefix("the ").strip()}
                if "," in part:
                    a, b = part.split(",", 1)
                    names |= {a.strip().lower(), b.strip().lower(), b.strip().lower().removeprefix("the ").strip()}
    return names


def online_match(name):
    url = "https://api.scryfall.com/cards/named?fuzzy=" + urllib.parse.quote(name)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "mtga-kb/1.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response).get("set", "").lower() == "lci"
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="do not query Scryfall")
    args = parser.parse_args()
    errors = []
    data = json.loads((LCI / "cards.json").read_text())
    for key in ("buildDate", "scryfallSnapshot", "seventeenLandsSnapshot"):
        if not data.get(key): errors.append(f"cards.json lacks {key}")
    pool = sum(c.get("inDraftPool") is not False for c in data["cards"].values())
    if pool != 291: errors.append(f"draftable pool is {pool}, expected 291")
    combat = (LCI / "combat-reference.md").read_text()
    if not re.search(r"Generated .* on \d{4}-\d{2}-\d{2}; source SHA-256 `[0-9a-f]{64}`", combat):
        errors.append("combat-reference.md lacks generation date or source hash")
    owners = [p for p in FILES if SENTINEL in p.read_text()]
    if owners != [RULES / "blocking-procedure.md"]: errors.append(f"declare-blockers sentinel owner count is {len(owners)}")
    heading = re.compile(r"^#{1,6} .*?(?:declare[- ]blockers.*procedure|procedure.*(?:blocking|blockers)).*$", re.I | re.M)
    for path in FILES:
        if path == RULES / "blocking-procedure.md": continue
        text = path.read_text(); match = heading.search(text)
        if match and "blocking-procedure.md" not in "\n".join(text[match.end():].lstrip().splitlines()[:2]):
            errors.append(f"{path.relative_to(DOCS)}: blocking procedure heading is not a pointer")
    link = re.compile(r"`?([^`\s]+\.md)`?\s+§(\d+)")
    for path in FILES:
        for target, section in link.findall(path.read_text()):
            candidates = [(path.parent / target).resolve(), RULES / Path(target).name, LCI / Path(target).name]
            found = next((p for p in candidates if p.exists()), None)
            if not found: errors.append(f"{path.relative_to(DOCS)}: missing {target} §{section}")
            elif not re.search(rf"^#+\s+{section}(?:\.|\s)", found.read_text(), re.M): errors.append(f"{path.relative_to(DOCS)}: {target} has no §{section}")
    known, unresolved, claims = known_names(data["cards"]), {}, 0
    for path in FILES:
        text = path.read_text()
        for match in NAME.finditer(text):
            raw, tail = match.group(1).strip(), text[match.end():match.end()+40]
            if raw.upper() == raw or not any(p.search(tail) for p in CLAIM): continue
            claims += 1
            variants = {raw, re.sub(r"'s\b", "", raw).strip(), raw.rstrip("s"), raw + "s"}
            for prefix in ("back of ", "blocking ", "untapped ", "plus ", "the "):
                if raw.lower().startswith(prefix): variants.add(raw[len(prefix):])
            if not any(v.lower() in ADJUDICATED or v.lower() in known for v in variants): unresolved.setdefault(raw, set()).add(str(path.relative_to(DOCS)))
    if not args.offline: unresolved = {n: p for n, p in unresolved.items() if not online_match(n)}
    errors += [f"unresolved LCI card name {n}: {', '.join(sorted(p))}" for n, p in sorted(unresolved.items())]
    print(f"{claims} card-name claims across {len(FILES)} files")
    if errors:
        print("\n".join(f"ERROR: {e}" for e in errors)); return 1
    print("knowledge base structure, references, metadata, and card claims are valid"); return 0


if __name__ == "__main__": sys.exit(main())
