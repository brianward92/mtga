#!/usr/bin/env python3
"""Build the follow-up PDF and a self-contained arXiv source archive."""

import hashlib
import gzip
import io
import json
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPER = ROOT / "paper"
OUT = PAPER / "submission"
HOB_FIGURE = "../docs/results/hob_oos_20260920/p1p1_comparison.png"
PACKAGED_HOB_FIGURE = "figs/p1p1_comparison.png"


def main() -> None:
    subprocess.run(
        [
            "latexmk",
            "-cd",
            "-pdf",
            "-interaction=nonstopmode",
            "-halt-on-error",
            str(PAPER / "draftfm_followup.tex"),
        ],
        check=True,
        cwd=ROOT,
    )
    OUT.mkdir(parents=True, exist_ok=True)

    source = (PAPER / "draftfm_followup.tex").read_text()
    if source.count(HOB_FIGURE) != 1:
        raise ValueError("Expected exactly one HOB figure reference")
    files = {
        "draftfm_followup.tex": source.replace(HOB_FIGURE, PACKAGED_HOB_FIGURE).encode()
    }
    for name in ("headline.tex", "paired.tex", "fra_top10.tex", "fra_uncommons10.tex"):
        path = PAPER / "data/followup_20260920" / name
        files[f"data/followup_20260920/{name}"] = path.read_bytes()
    files[PACKAGED_HOB_FIGURE] = (
        ROOT / "docs/results/hob_oos_20260920/p1p1_comparison.png"
    ).read_bytes()
    for path in sorted((PAPER / "figs/cards/fra").glob("*.jpg")):
        files[f"figs/cards/fra/{path.name}"] = path.read_bytes()
    if len(files) != 12:
        raise ValueError(f"Expected 12 source files, found {len(files)}")

    archive = OUT / "draftfm_followup_arxiv_source.tar.gz"
    with archive.open("wb") as stream:
        with gzip.GzipFile(
            fileobj=stream, mode="wb", filename="", mtime=0
        ) as zipped:
            with tarfile.open(fileobj=zipped, mode="w|") as tar:
                for name, content in sorted(files.items()):
                    info = tarfile.TarInfo(name)
                    info.size = len(content)
                    info.mode = 0o644
                    info.mtime = 0
                    tar.addfile(info, io.BytesIO(content))

    pdf = (PAPER / "draftfm_followup.pdf").read_bytes()
    (OUT / "draftfm_followup_ssrn.pdf").write_bytes(pdf)
    hashes = {
        name: hashlib.sha256(content).hexdigest()
        for name, content in sorted(files.items())
    }
    hashes[archive.name] = hashlib.sha256(archive.read_bytes()).hexdigest()
    hashes["draftfm_followup_ssrn.pdf"] = hashlib.sha256(pdf).hexdigest()
    (OUT / "sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
    print(f"SSRN PDF: {OUT / 'draftfm_followup_ssrn.pdf'}")
    print(f"arXiv source: {archive}")


if __name__ == "__main__":
    main()
