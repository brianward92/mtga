"""Win-probability model v1: V(state) = P(win | turn-t state), tabular only.

data.py       turn-state parquet + per-game sidecar -> feature arrays
model.py      one net for all three heads (logistic when hidden=())
train.py      training loop, per-turn-bucket evaluation, persistence
economics.py  card-value gradients from the MLP (a card in life-equivalents)
"""
