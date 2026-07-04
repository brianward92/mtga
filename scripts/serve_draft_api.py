#!/usr/bin/env python
"""Serve the draft assistant API (see mtga/draft_api.py) on :8100."""

import argparse

from mtga.draft_api import serve


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8100)
    return parser


if __name__ == "__main__":
    args = create_parser().parse_args()
    serve(host=args.host, port=args.port)
