"""Mulligan v1 outcome head: a small CPU-friendly MLP.

Input is the assembled decision vector from data.assemble() (hand mean+max
pool, deck mean pool, engineered extras); output is a single logit for
P(win | kept this hand). Inputs are already ~[0, 1] scaled by the frozen
featurizer, so no input normalization layers.
"""

import numpy as np
import torch
import torch.nn as nn

from mtga.mulligan.data import assemble

DEFAULT_HIDDEN = (128, 64)
DEFAULT_DROPOUT = 0.1


class MulliganNet(nn.Module):
    def __init__(self, input_dim, hidden=DEFAULT_HIDDEN,
                 dropout=DEFAULT_DROPOUT):
        super().__init__()
        layers, previous = [], input_dim
        for width in hidden:
            layers += [nn.Linear(previous, width), nn.ReLU(),
                       nn.Dropout(dropout)]
            previous = width
        layers.append(nn.Linear(previous, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        """[B, input_dim] -> [B] win logits."""
        return self.net(x).squeeze(-1)


def predict_proba(model, data, idx, batch_size=8192):
    """Sigmoid P(win | keep) for the given decision rows, as float64 [len(idx)]."""
    model.eval()
    out = np.empty(len(idx), dtype=np.float64)
    with torch.no_grad():
        for start in range(0, len(idx), batch_size):
            rows = idx[start:start + batch_size]
            x = torch.from_numpy(assemble(data, rows))
            out[start:start + len(rows)] = torch.sigmoid(model(x)).numpy()
    return out
