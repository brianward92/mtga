# Domain documentation

These documents support DraftFM feature engineering and provide a checked reference for reviewing model inputs and output.

- [`rules/`](rules/) contains set-agnostic Magic rules.
- [`formats/lci/`](formats/lci/) contains Lost Caverns of Ixalan Quick Draft facts and generated card data.
- [`eval_protocol.md`](eval_protocol.md) and [`eval_protocol_rebuild.md`](eval_protocol_rebuild.md) record the frozen DraftFM evaluation protocol.

Regenerate the LCI card snapshot with `python3 scripts/build_kb_cards.py LCI`, then regenerate the combat tables with `python3 scripts/build_kb_combat.py LCI`. Verify all knowledge documents without network access with:

```sh
python3 scripts/check_kb_cards.py --offline
```

