"""DraftFM-v1: feature-projected two-tower pick scorer.

Design invariants (the zero-shot contract):
- NO set-identity embedding anywhere. The only way the model can know what
  set it is drafting is through card features — so "UR is spells-matter
  here but artifacts there" must be INFERRED from the set's actual card
  list (set-context module) and from the drafter's accumulating pool
  (pool tower + candidate x pool interaction). That inference transfers to
  a set released tomorrow; a memorized set ID cannot.
- Skill is a conditioning input to the SCORER, never the card encoder:
  card semantics are skill-invariant, the policy is skill-dependent. Every
  training pick is tagged with its drafter's skill bucket ("decision + tag
  by venue"); serving conditions on a top bucket.
- Cards enter as frozen feature vectors (structured + text embedding), so
  a brand-new set is scoreable the moment Scryfall knows its cards.

Per training step the batch is homogeneous in (set, format): the card
encoder runs ONCE over the set's full card list (~[400, feat] matmul) and
everything else gathers rows from that table — the key MPS optimization.
"""

import torch
import torch.nn as nn

from mtga.foundation.dataset import PAD, POOL_COUNT_CAP

D_MODEL = 256
N_QUERIES = 4
N_HEADS = 4
CTX_DIM = 64


class CardEncoder(nn.Module):
    def __init__(self, feat_dim, d=D_MODEL):
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(feat_dim),
            nn.Linear(feat_dim, 512), nn.GELU(),
            nn.Linear(512, d), nn.GELU(),
            nn.LayerNorm(d),
        )

    def forward(self, features):  # [N, feat] -> [N, d]
        return self.net(features)


class QueryPool(nn.Module):
    """K learned queries cross-attend over a set of card embeddings."""

    def __init__(self, d=D_MODEL, n_queries=N_QUERIES, n_heads=N_HEADS):
        super().__init__()
        self.queries = nn.Parameter(torch.randn(n_queries, d) * 0.02)
        self.attention = nn.MultiheadAttention(d, n_heads, batch_first=True)
        self.project = nn.Linear(n_queries * d, d)

    def forward(self, keys, key_padding_mask=None):
        # keys: [B, L, d] -> [B, d]
        batch = keys.shape[0]
        queries = self.queries.unsqueeze(0).expand(batch, -1, -1)
        attended, _ = self.attention(
            queries, keys, keys, key_padding_mask=key_padding_mask,
            need_weights=False,
        )
        return self.project(attended.flatten(1))


class DraftFM(nn.Module):
    def __init__(self, feat_dim, d=D_MODEL, dropout=0.1, set_ctx=True):
        super().__init__()
        self.d = d
        self.set_ctx = set_ctx
        self.card_encoder = CardEncoder(feat_dim, d)

        # Pool tower
        self.count_embedding = nn.Embedding(POOL_COUNT_CAP + 1, d)
        self.pool_tower = QueryPool(d)
        self.empty_pool = nn.Parameter(torch.zeros(d))

        # Set-context tower (reads the whole set's card list)
        if set_ctx:
            self.rarity_embedding = nn.Embedding(6, d)  # via feature rarity id
            self.set_tower = QueryPool(d)

        # Context: skill/games/format embeddings + position floats
        self.wr_embedding = nn.Embedding(256, 16)      # ids 15..45 + 255 missing
        self.games_embedding = nn.Embedding(256, 8)
        self.format_embedding = nn.Embedding(4, 8)
        ctx_in = 16 + 8 + 8 + 7 + 4 + (d if set_ctx else 0)
        self.context_mlp = nn.Sequential(
            nn.Linear(ctx_in, 128), nn.GELU(), nn.Linear(128, CTX_DIM),
        )

        self.scorer = nn.Sequential(
            nn.Linear(3 * d + CTX_DIM, 512), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(512, 256), nn.GELU(),
            nn.Linear(256, 1),
        )

    def encode_set(self, features, rarity_ids=None):
        """Card table T [N, d] and (optionally) the set summary [d]."""
        table = self.card_encoder(features)
        summary = None
        if self.set_ctx:
            keys = table
            if rarity_ids is not None:
                keys = keys + self.rarity_embedding(rarity_ids)
            summary = self.set_tower(keys.unsqueeze(0)).squeeze(0)
        return table, summary

    def forward(self, table, set_summary, batch):
        """Score a homogeneous-set batch.

        table: [N_set, d] from encode_set (same graph when training)
        batch dict tensors:
          pool_slots  [B, 46] long (PAD = padding)
          pool_counts [B, 46] long
          pack_slots  [B, 16] long
          position    [B, 7]  float (pack#/pick# encodings, pool size, ...)
          set_scalars [B, 4]  float
          wr_id/games_id/format_id [B] long
        Returns logits [B, 16] with -inf at pack padding.
        """
        pool_mask = batch["pool_slots"].eq(int(PAD))
        pool_slots = batch["pool_slots"].masked_fill(pool_mask, 0)
        pool_emb = table[pool_slots] + self.count_embedding(batch["pool_counts"])
        # Fully-empty pools (P1P1) attend over a learned null token instead.
        empty = pool_mask.all(dim=1)
        if empty.any():
            pool_emb[empty, 0] = self.empty_pool
            pool_mask = pool_mask.clone()
            pool_mask[empty, 0] = False
        pool_summary = self.pool_tower(pool_emb, key_padding_mask=pool_mask)

        parts = [
            self.wr_embedding(batch["wr_id"]),
            self.games_embedding(batch["games_id"]),
            self.format_embedding(batch["format_id"]),
            batch["position"],
            batch["set_scalars"],
        ]
        if self.set_ctx:
            parts.append(set_summary.unsqueeze(0).expand(len(pool_summary), -1))
        context = self.context_mlp(torch.cat(parts, dim=1))

        pack_mask = batch["pack_slots"].eq(int(PAD))
        pack_slots = batch["pack_slots"].masked_fill(pack_mask, 0)
        candidates = table[pack_slots]                       # [B, 16, d]
        pool_b = pool_summary.unsqueeze(1).expand_as(candidates)
        ctx_b = context.unsqueeze(1).expand(-1, candidates.shape[1], -1)
        h = torch.cat([candidates, pool_b, candidates * pool_b, ctx_b], dim=2)
        logits = self.scorer(h).squeeze(-1)                  # [B, 16]
        return logits.masked_fill(pack_mask, float("-inf"))


def position_features(context_ints, picks_per_pack):
    """uint8 context columns -> the 7 float position features (torch)."""
    pack_number = context_ints[:, 0].float()
    pick_number = context_ints[:, 1].float()
    ppp = float(picks_per_pack)
    pool_size = pack_number * ppp + pick_number
    return torch.stack([
        (pack_number == 0).float(),
        (pack_number == 1).float(),
        (pack_number == 2).float(),
        pick_number / ppp,
        (ppp - 1 - pick_number).clamp(min=0) / ppp,
        pool_size / 45.0,
        (pool_size / (3 * ppp)).clamp(max=1.0),
    ], dim=1)


def masked_cross_entropy(logits, pick_pos, label_smoothing=0.05):
    """Cross-entropy with label smoothing over VALID pack slots only.

    Standard label smoothing would place mass on the -inf padded slots and
    make the loss infinite; smoothing is renormalized over real candidates.
    """
    logp = torch.log_softmax(logits, dim=1)
    valid = torch.isfinite(logits)
    n_valid = valid.sum(dim=1).clamp(min=1)
    target_lp = logp.gather(1, pick_pos.unsqueeze(1)).squeeze(1)
    smooth_lp = logp.masked_fill(~valid, 0).sum(dim=1) / n_valid
    loss = -(1 - label_smoothing) * target_lp - label_smoothing * smooth_lp
    return loss.mean()
