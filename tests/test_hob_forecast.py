"""Hand-computed checks for the prospective forecast comparison.

Run with .venv-embed/bin/python -m unittest discover -s tests -p test_hob_forecast.py
"""

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from scripts import eval_hob_forecast as ev
from scripts import eval_hob_fitted_benchmark as fitted


class ForecastComparisonTests(unittest.TestCase):
    def test_ties_receive_fractional_credit_and_unoffered_cards_cannot_win(self):
        offered = np.array([[1, 1, 0, 0], [1, 1, 1, 0], [1, 0, 1, 0]], bool)
        eligible, credit, inclusive, ties = ev.evaluate_pack_scores(
            offered, np.array([0, 2, 2]), np.array([4.0, 4.0, 2.0, 100.0])
        )
        np.testing.assert_array_equal(eligible, [True, True, True])
        np.testing.assert_allclose(credit, [0.5, 0.0, 0.0])
        np.testing.assert_array_equal(inclusive, [1, 0, 0])
        np.testing.assert_array_equal(ties, [2, 2, 1])

    def test_missing_grade_excludes_whole_pack_only_when_card_is_offered(self):
        offered = np.array([[1, 1, 0], [1, 0, 1], [1, 0, 0], [0, 0, 0]], bool)
        eligible, _, _, _ = ev.evaluate_pack_scores(
            offered, np.array([0, 0, 1, -1]), np.array([3.0, 2.0, np.nan])
        )
        # Second pack cannot discard its ungraded option; third's pick is absent.
        np.testing.assert_array_equal(eligible, [True, False, False, False])

    def test_comparisons_use_identical_eligible_packs(self):
        results = {
            "draftfm": (
                np.array([1, 1, 0], bool),
                np.array([1.0, 0.0, 0.0]),
                np.array([1.0, 0.0, 0.0]),
                np.ones(3),
            ),
            "creator": (
                np.array([0, 1, 1], bool),
                np.array([0.0, 1.0, 0.0]),
                np.array([0.0, 1.0, 0.0]),
                np.ones(3),
            ),
        }
        (row,) = ev.compare_rows(
            {"all": np.ones(3, bool)}, results, np.ones(3) / 3, list(results), 20
        )
        self.assertEqual(row["eligible_drafts"], 1)
        self.assertEqual(row["draftfm_accuracy"], 0)
        self.assertEqual(row["creator_accuracy"], 1)
        self.assertEqual(row["delta"], -1)
        self.assertEqual([row["delta_ci_low"], row["delta_ci_high"]], [-1, -1])

    def test_grade_and_double_face_mapping_preserve_original_predictions(self):
        self.assertEqual(ev.grade_value("D / B"), ev.RUNG["D"])
        self.assertEqual(ev.grade_value("7.5"), 7.5)
        self.assertIsNone(ev.grade_value("SB"))
        with self.assertRaises(ValueError):
            ev.grade_value("NaN")
        aliases = ev.aliases_for(["An Unexpected Party // At the Door"])
        self.assertEqual(aliases["at the door"], aliases["an unexpected party"])
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            ev.aliases_for(["Front // Shared", "Other // Shared"])

    def test_duplicate_first_picks_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "drafts.csv.gz"
            frame = pd.DataFrame(
                {"draft_id": ["x", "x"], "pack_number": [0, 0], "pick_number": [0, 0]}
            )
            frame.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "duplicate"):
                ev.load_picks(path)
            frame.loc[1, "pick_number"] = 1
            frame.to_csv(path, index=False)
            picks, n = ev.load_picks(path)
            self.assertEqual(len(picks), 1)
            self.assertEqual(n, 2)

    def test_changed_forecast_is_rejected_before_analysis(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "forecast.csv"
            path.write_text("not the sealed forecast\n")
            with self.assertRaisesRegex(ValueError, "public HOB seal"):
                ev.load_forecasts(path, None, None)

    def test_choice_model_gradient_and_known_optimum(self):
        offered = np.ones((4, 2), bool)
        picked = np.array([0, 0, 0, 1])
        weights = np.array([0.2, -0.3])
        loss, gradient = fitted.choice_loss_and_gradient(weights, offered, picked)
        for i in range(2):
            delta = np.eye(2)[i] * 1e-5
            hi = fitted.choice_loss_and_gradient(weights + delta, offered, picked)[0]
            lo = fitted.choice_loss_and_gradient(weights - delta, offered, picked)[0]
            self.assertAlmostEqual(gradient[i], (hi - lo) / 2e-5, places=7)
        result = fitted.fit_weights(offered, picked)
        self.assertLess(result.fun, loss)
        self.assertGreater(result.x[0], result.x[1])
        self.assertAlmostEqual(float(result.x.sum()), 0, places=7)

    def test_crossfit_never_sees_its_own_fold(self):
        from unittest.mock import patch

        ids = []
        for fold in range(5):
            ids.append(
                next(
                    f"draft-{i}"
                    for i in range(1000)
                    if fitted.fold_for(f"draft-{i}") == fold
                )
            )
        # Every draft contains its own identity card. Inspect each training pack
        # matrix to prove the held-out identity was never passed to the fitter.
        offered = np.ones((5, 5), bool)
        picked = np.arange(5)
        seen = []
        real_fit = fitted.fit_weights

        def audited_fit(pack, target):
            fold = len(seen)
            self.assertNotIn(fold, target)
            self.assertEqual(len(target), 4)
            seen.append(fold)
            return real_fit(pack, target)

        with patch.object(fitted, "fit_weights", side_effect=audited_fit):
            _, folds, reports, _ = fitted.crossfit(
                offered, picked, ids, np.ones(5, bool), np.ones(5, bool)
            )
        np.testing.assert_array_equal(folds, range(5))
        self.assertEqual(seen, list(range(5)))
        self.assertTrue(all(r["heldout_drafts"] == 1 for r in reports))


if __name__ == "__main__":
    unittest.main()
