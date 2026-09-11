# Live draft run, 2026-09-10 — improvement data

Collected as it happened. Each entry: what was observed, what it cost, what to change.

## Draft phase

- **First glyph clipped, three ways.** "hupacabra Echo" (missing), "Valk with
  the Ancestors" (W read as V), "kawalli … Tower 1*" (missing + trailing pip).
  Three matcher patches. Root cause: the verify band's 12% left inset cuts into
  the first letter. Fix the band, keep the tolerant matcher as defence.
- **Stray tokens on the title row** ("1", "4"). The nearest-to-centre rule chose
  them over the title. Any-line-in-cell is now the rule; safe because the crop
  is per cell.
- **A refused pick parked the loop** until its budget ran out: no pick timer in a
  bot draft means nothing else changes the position. Now retries, gives up at 6.
- **Loop output drops the MISMATCH detail** (its grep keeps only the verdict
  line), so a refusal needs a manual re-run to diagnose. Echo the detail too.
- **Purchase confirm button is "OK"** — two characters, and a "longer than two"
  filter skipped it. Button matching must not assume length.
- **Overlay restores the previous completed draft on launch** (phase=complete,
  pool=45). The draft loop exits immediately on phase=complete, so it must not
  be started until the mirror shows the new course.

## Timing

- Pick cadence with the loop healthy: ~5s per pick, ~25s of verified picks
  between refusals.
