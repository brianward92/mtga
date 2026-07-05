"""Win-probability v1 heads: one net covers all three comparison models.

The whole point of v1 is the 1-vs-2-vs-3 comparison, so a single class spans
it by construction:
  * hidden=() -> a bare Linear(k, 1): logistic regression. With a single
    input column (life_diff) that is the naive baseline (model 1); with all
    25 columns it is the linear ceiling (model 2).
  * hidden=(64, 32) -> the MLP (model 3) whose only claim over model 2 is
    non-linearity.

Inputs are STANDARDIZED features (data.standardize); the net never sees raw
units. `columns` records which FEATURES indices this head consumes so the
same standardized matrix drives all three.
"""

import numpy as np
import torch
import torch.nn as nn

MLP_HIDDEN = (64, 32)


class WinProbNet(nn.Module):
    """MLP over standardized state features; hidden=() is plain logistic."""

    def __init__(self, input_dim, hidden=MLP_HIDDEN, dropout=0.0):
        super().__init__()
        layers, previous = [], input_dim
        for width in hidden:
            layers += [nn.Linear(previous, width), nn.ReLU()]
            if dropout:
                layers.append(nn.Dropout(dropout))
            previous = width
        layers.append(nn.Linear(previous, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        """[B, input_dim] -> [B] win logits."""
        return self.net(x).squeeze(-1)


def predict_proba(model, Xs, columns, batch_size=65536):
    """Sigmoid P(win) over standardized rows Xs restricted to `columns`.

    Xs is the full standardized matrix; columns selects this head's inputs.
    Returns float64 [len(Xs)].
    """
    model.eval()
    cols = np.asarray(columns)
    out = np.empty(len(Xs), dtype=np.float64)
    with torch.no_grad():
        for start in range(0, len(Xs), batch_size):
            chunk = Xs[start:start + batch_size][:, cols]
            logits = model(torch.from_numpy(np.ascontiguousarray(chunk)))
            out[start:start + len(chunk)] = torch.sigmoid(logits).numpy()
    return out
