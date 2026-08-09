import json

from scripts.fetch_untapped_pick_order import (
    aggregate_card_stats,
    normalize_snapshot,
    parse_page,
)


def fixture_html():
    page = {
        "props": {
            "pageProps": {
                "clientProps": {"setCode": "TST"},
                "ssrProps": {
                    "minifiedMtgaJsonData": {
                        "localeData": [[1001, "Alpha"], [1002, "Beta"]],
                        "cardData": [[11, 1001], [12, 1002]],
                    },
                    "limitedCardStatsResp": {
                        "lastModified": 1_700_000_000_000,
                        "data": {
                            "data": {
                                "1001": {
                                    "ALL": {
                                        "b": [[10], [8, 5], [4, 3]],
                                        "p": [[20], [12, 7], [6, 4]],
                                    }
                                }
                            }
                        },
                    },
                    "limitedDraftInfo": {
                        "lastModified": 1_700_000_100_000,
                        "data": [
                            {
                                "title_id": 1001,
                                "offered_qty": {"bronze": 1, "platinum": 3},
                                "avg_pick_chosen": {"bronze": 2, "platinum": 4},
                                "avg_last_pick_offered": {"bronze": 3, "platinum": 5},
                            }
                        ],
                    },
                },
            }
        },
    }
    return f"""
      <span>Tier</span><span>A<span>+</span></span>
      <a href="/card-data?includingCards=1001"><img alt="Alpha"></a>
      <span>Tier</span><span>D</span>
      <a href="/card-data?includingCards=1002"><img alt="Beta"></a>
      <script id="__NEXT_DATA__" type="application/json">{json.dumps(page)}</script>
    """


def test_parse_page_extracts_visible_tier_order_and_next_data():
    page, cards = parse_page(fixture_html())
    assert page["props"]["pageProps"]["clientProps"]["setCode"] == "TST"
    assert cards == [(1001, "A+"), (1002, "D")]


def test_aggregate_card_stats_sums_rank_blocks():
    result = aggregate_card_stats(
        {
            "ALL": {
                "b": [[10], [8, 5], [4, 3]],
                "p": [[20], [12, 7], [6, 4]],
            }
        }
    )
    assert result["games"] == 30
    assert result["in_hand_games"] == 20
    assert result["in_hand_wins"] == 12
    assert result["in_hand_win_rate"] == 0.6
    assert result["opening_hand_win_rate"] == 0.7


def test_normalize_snapshot_joins_identity_stats_tiers_and_offer_data():
    result = normalize_snapshot(
        fixture_html(), "https://example.test/pick-order", "2026-07-12T23:30:00Z"
    )
    assert result["set"] == "TST"
    assert result["fetched_at"] == "2026-07-12T23:30:00Z"
    assert [card["name"] for card in result["cards"]] == ["Alpha", "Beta"]
    alpha = result["cards"][0]
    assert alpha["grp_id"] == 11
    assert alpha["tier"] == "A+"
    assert alpha["avg_pick_chosen"] == 3.5
    assert alpha["avg_last_offered"] == 4.5
    assert result["cards"][1]["in_hand_win_rate"] is None
