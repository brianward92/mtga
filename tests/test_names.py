"""mtga/lands/names.py: 17Lands <-> Scryfall join normalization."""

from mtga.lands import names


def test_norm_casefolds_and_strips():
    # The DMU case mismatch: 17Lands "Sol'kanar" vs Scryfall "Sol'Kanar".
    assert names.norm("Sol'kanar the Tainted") == names.norm("Sol'Kanar the Tainted")
    assert names.norm("  Lightning Bolt ") == "lightning bolt"


def test_norm_composes_nfc():
    decomposed = "Bespoke Bo\u0304"  # o + combining macron (NFD)
    composed = "Bespoke B\u014d"     # precomposed o-macron (NFC)
    assert decomposed != composed    # sanity: distinct code points going in
    assert names.norm(decomposed) == names.norm(composed) == "bespoke bō"


def test_norm_17lands_maps_ascii_mangled_alias():
    # TMT: 17Lands ships "Bespoke B?" for Scryfall's "Bespoke Bō".
    assert names.norm_17lands("Bespoke B?") == names.norm("Bespoke Bō")
    assert names.norm_17lands("BESPOKE B? ") == "bespoke bō"


def test_norm_17lands_passthrough_for_clean_names():
    assert names.norm_17lands("Lightning Bolt") == "lightning bolt"
    assert names.norm_17lands('Henzie "Toolbox" Torre') == 'henzie "toolbox" torre'


def test_alias_keys_are_normed():
    assert all(names.norm(k) == k for k in names.ALIASES_17L)
