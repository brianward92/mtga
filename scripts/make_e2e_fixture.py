#!/usr/bin/env python3
"""Generate the E2E draft fixture: a full synthetic SOS Quick draft log.

Produces electron/tests/e2e/fixtures/quickdraft_sos.log — 3 packs x 14 picks
of BotDraftDraftStatus / BotDraftDraftPick lines shaped exactly like the
parser fixtures (electron/tests/fixtures/quick-draft.log), but using REAL SOS
grp_ids so the live draft server (--scores-mode live in drive.mjs) returns
real scores for every pack.

Card source: SOS vocab names (what the model actually knows) mapped to Arena
grp_ids via the 17Lands card store:
  /opt/bward/dat/mtga/17lands/curated/draft/SOS.PremierDraft.vocab.json
  /opt/bward/dat/mtga/17lands/cards/card_store.parquet

Deterministic (seeded RNG): rerunning regenerates the identical log.

  python3 scripts/make_e2e_fixture.py [--out electron/tests/e2e/fixtures/quickdraft_sos.log]
"""

import argparse
import json
import random
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VOCAB = Path("/opt/bward/dat/mtga/17lands/curated/draft/SOS.PremierDraft.vocab.json")
CARD_STORE = Path("/opt/bward/dat/mtga/17lands/cards/card_store.parquet")
DEFAULT_OUT = REPO / "electron/tests/e2e/fixtures/quickdraft_sos.log"

EVENT_NAME = "QuickDraft_SOS_20260703"
PACKS = 3
PICKS_PER_PACK = 14
# MTGA booster shape: 1 rare/mythic, 3 uncommons, 10 commons
BOOSTER_SHAPE = [("rare_slot", 1), ("uncommon", 3), ("common", 10)]
MYTHIC_ODDS = 1 / 8
SEED = 20260703


def load_cards_by_rarity() -> dict:
    """vocab names -> {rarity: [grp_id, ...]}, SOS-expansion cards only."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    names = json.load(open(VOCAB))["names"]
    table = pq.read_table(CARD_STORE, columns=["grp_id", "expansion", "name", "rarity"])
    table = table.filter(pc.equal(table["expansion"], "SOS"))
    by_name = {}
    for i in range(table.num_rows):
        row = {c: table[c][i].as_py() for c in table.column_names}
        by_name.setdefault(row["name"], row)

    pools: dict = {"common": [], "uncommon": [], "rare": [], "mythic": []}
    for name in names:
        row = by_name.get(name)
        if row and row["rarity"] in pools:
            pools[row["rarity"]].append(row["grp_id"])
    for rarity, ids in pools.items():
        if not ids:
            raise SystemExit(f"no SOS {rarity} cards mapped — card store moved?")
        ids.sort()
    return pools


def make_booster(rng: random.Random, pools: dict, size: int) -> list:
    """A booster passed to us with `size` cards left (14 = fresh)."""
    cards = []
    rare_pool = pools["mythic"] if rng.random() < MYTHIC_ODDS else pools["rare"]
    cards.extend(rng.sample(rare_pool, 1))
    cards.extend(rng.sample(pools["uncommon"], 3))
    cards.extend(rng.sample(pools["common"], 10))
    rng.shuffle(cards)
    return cards[:size]  # earlier drafters already took 14 - size cards


def bot_pick(rng: random.Random, pack: list, pools: dict) -> int:
    """Rare-greedy pick with some noise (looks like a plausible human)."""
    weight = {"mythic": 8.0, "rare": 6.0, "uncommon": 2.5, "common": 1.0}
    rarity_of = {g: r for r, ids in pools.items() for g in ids}
    scored = [(weight[rarity_of[g]] * rng.uniform(0.6, 1.4), g) for g in pack]
    return max(scored)[1]


def status_payload(status: str, extra: dict) -> str:
    payload = {"Result": "Success", "EventName": EVENT_NAME, "DraftStatus": status}
    payload.update(extra)
    outer = {"CurrentModule": "BotDraft", "Payload": json.dumps(payload)}
    return json.dumps(outer)


def pick_request(req_id: str, grp_id: int, pack_number: int, pick_number: int) -> str:
    pick_info = {
        "EventName": EVENT_NAME,
        "CardIds": [str(grp_id)],
        "PackNumber": pack_number,
        "PickNumber": pick_number,
    }
    request = {"EventName": EVENT_NAME, "PickInfo": pick_info}
    return json.dumps({"id": req_id, "request": json.dumps(request)})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    rng = random.Random(SEED)
    pools = load_cards_by_rarity()

    lines = ["[UnityCrossThreadLogger]DETAILED LOGS: ENABLED"]
    # Event_Join announces the pod first — the tracker shows draft-start
    # ("waiting for pack") before the first status arrives, like the client.
    join = {
        "id": "e1",
        "request": json.dumps({"EventName": EVENT_NAME, "EntryCurrencyType": "Gem"}),
    }
    lines.append(f"[UnityCrossThreadLogger]==> EventJoin {json.dumps(join)}")

    pool: list = []
    seq = 0
    for pack_number in range(PACKS):
        for pick_number in range(PICKS_PER_PACK):
            pack = make_booster(rng, pools, PICKS_PER_PACK - pick_number)
            next_state = {
                "PackNumber": pack_number,
                "PickNumber": pick_number,
                "NumCardsToPick": 1,
                "DraftPack": [str(g) for g in pack],
                "PickedCards": [str(g) for g in pool],
            }
            if pack_number == 0 and pick_number == 0:
                # First pack: pushed by a status poll
                lines.append(
                    "[UnityCrossThreadLogger]<== BotDraftDraftStatus "
                    + status_payload("PickNext", next_state)
                )
            else:
                # Subsequent packs arrive as the response to the previous pick
                lines.append(
                    "[UnityCrossThreadLogger]<== BotDraftDraftPick "
                    + status_payload("PickNext", next_state)
                )

            chosen = bot_pick(rng, pack, pools)
            pool.append(chosen)
            seq += 1
            lines.append(
                "[UnityCrossThreadLogger]==> BotDraftDraftPick "
                + pick_request(f"b{seq}", chosen, pack_number, pick_number)
            )

    lines.append(
        "[UnityCrossThreadLogger]<== BotDraftDraftPick "
        + status_payload(
            "Completed",
            {"PickedCards": [str(g) for g in pool], "DraftPack": []},
        )
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{args.out}: {len(lines)} lines, {len(pool)} picks")


if __name__ == "__main__":
    main()
