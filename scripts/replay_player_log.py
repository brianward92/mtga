#!/usr/bin/env python
"""Replay a recorded/synthesized Player.log into a fake log file with pacing.

The end-to-end test rig: point the Electron client at the output file via
MTGA_LOG_PATH and watch a whole draft flow through parser -> overlay -> API
with no MTGA anywhere. Also the post-Arena-update triage tool.

  replay_player_log.py --fixture electron/tests/fixtures/premier_draft.log \
      --out /tmp/fake_player.log --speed 20 [--truncate-at 0.5]
"""

import argparse
import time
from pathlib import Path


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--out", default="/tmp/fake_player.log")
    parser.add_argument("--speed", type=float, default=20.0,
                        help="lines per second")
    parser.add_argument("--truncate-at", type=float, default=None,
                        help="fraction (0-1) of the way through, truncate the "
                             "file and restart from 0 — exercises reopen logic")
    return parser


def main():
    args = create_parser().parse_args()
    lines = Path(args.fixture).read_text(encoding="utf-8").splitlines(keepends=True)
    out = Path(args.out)
    out.write_text("")
    delay = 1.0 / args.speed
    truncate_index = (
        int(len(lines) * args.truncate_at) if args.truncate_at is not None else None
    )

    def play(sequence, mode="a"):
        with open(out, mode, encoding="utf-8") as file:
            for i, line in enumerate(sequence):
                file.write(line)
                file.flush()
                if i % 25 == 0:
                    print(f"  {i}/{len(sequence)} lines")
                time.sleep(delay)

    if truncate_index:
        print(f"playing {truncate_index} lines, then truncating (Arena restart)...")
        play(lines[:truncate_index])
        out.write_text("")  # size-shrink: the watcher must reopen from 0
        time.sleep(1)
        print("truncated; replaying the full log from the top...")
    print(f"playing {len(lines)} lines at {args.speed}/s -> {out}")
    play(lines)
    print("done")


if __name__ == "__main__":
    main()
