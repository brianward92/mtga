#!/usr/bin/env python
"""Replay a held-out human draft in the terminal: model pick vs actual pick.

Picks a random validation-split draft (never seen in training) unless
--draft-id is given. For each pick: the model's top-3 with EVs, the human's
actual choice, and whether they agreed.
"""

import argparse
import zlib

import duckdb
import numpy as np

from mtga.lands import cardstore, paths
from mtga.models import registry
from mtga.models.draftnet import VAL_PERMILLE, load_vocab


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--format", dest="limited_type", default="PremierDraft")
    parser.add_argument("--draft-id", default=None)
    parser.add_argument("--seed", type=int, default=None)
    return parser


def main():
    args = create_parser().parse_args()
    set_code = args.set_code.upper()
    parquet = paths.curated_path("draft", set_code, args.limited_type)
    vocab = load_vocab(set_code, args.limited_type)
    canonical, _, _ = cardstore.name_resolution(set_code)
    grp_of = [canonical.get(name) for name in vocab]

    con = duckdb.connect()
    draft_id = args.draft_id
    if draft_id is None:
        ids = [
            r[0]
            for r in con.execute(
                f"SELECT DISTINCT draft_id FROM '{parquet}' USING SAMPLE 2000 ROWS"
            ).fetchall()
        ]
        val_ids = [d for d in ids if zlib.crc32(d.encode()) % 1000 < VAL_PERMILLE]
        rng = np.random.default_rng(args.seed)
        draft_id = val_ids[int(rng.integers(len(val_ids)))]

    pack_cols = ", ".join(f'"pack_card_{n}"' for n in vocab)
    rows = con.execute(
        f"""
        SELECT pack_number, pick_number, pick_index, rank,
               event_match_wins, event_match_losses, [{pack_cols}] AS pack
        FROM '{parquet}' WHERE draft_id = ?
        ORDER BY pack_number, pick_number
        """,
        [draft_id],
    ).fetchall()
    con.close()
    if not rows:
        raise SystemExit(f"draft {draft_id} not found")

    model = registry.resolve(set_code, args.limited_type)
    header_rank = rows[0][3] or "?"
    record = f"{rows[0][4]}-{rows[0][5]}"
    print(
        f"draft {draft_id} | {set_code} {args.limited_type} | rank {header_rank} "
        f"| event record {record}\nmodel: {model.model_id}\n"
    )

    pool, agree, total = [], 0, 0
    for pack_number, pick_number, pick_index, *_rest, pack_counts in rows:
        pack_grps, seen_names = [], {}
        for i, count in enumerate(pack_counts):
            for _ in range(int(count)):
                if grp_of[i] is not None:
                    pack_grps.append(grp_of[i])
                    seen_names[grp_of[i]] = vocab[i]
        if not pack_grps:
            continue
        scores = model.score_pack(pack_grps, pool, pack_number, pick_number)
        top = [s for s in sorted(scores, key=lambda s: s.rank)][:3]
        human_grp = grp_of[pick_index] if pick_index >= 0 else None
        human_rank = next((s.rank for s in scores if s.grp_id == human_grp), None)
        hit = human_rank == 1
        agree += int(hit)
        total += 1
        mark = "=" if hit else " "
        top_str = ", ".join(
            f"{seen_names.get(s.grp_id, '?')} "
            f"({f'{s.ev:+.1f}' if s.ev is not None else '?'})"
            for s in top
        )
        print(
            f"P{int(pack_number) + 1}P{int(pick_number) + 1:>2} {mark} "
            f"human: {vocab[pick_index] if pick_index >= 0 else '?':<30} "
            f"(model rank {human_rank})  model: {top_str}"
        )
        if human_grp is not None:
            pool.append(human_grp)

    print(f"\nagreement: {agree}/{total} = {agree / total:.0%}")


if __name__ == "__main__":
    main()
