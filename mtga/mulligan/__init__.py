"""Mulligan model v1: P(win | opening hand, on_play, deck, hand_size).

data.py   decision rows + deck sidecar + frozen card features -> arrays
model.py  the small MLP outcome head
train.py  training loop, evaluation protocol, artifact persistence
"""
