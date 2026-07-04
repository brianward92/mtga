"""DraftFM training loop (torch MPS eager, per the frozen recipe).

Safety rails (mandatory, from the Apple-Silicon stack research):
- short CPU-vs-MPS parity run at startup — guards the silent-wrong-math MPS
  bug class (loss divergence must stay < 1e-3 relative);
- NaN/spike watchdog every LOG_EVERY steps (halt, don't auto-resume);
- optimizer params kept contiguous (MPS fused-Adam corruption class);
- PYTORCH_ENABLE_MPS_FALLBACK stays unset so unsupported ops fail loudly.
"""

import json
import math
import time
from dataclasses import asdict, dataclass, field

import numpy as np
import torch

from mtga.foundation import runlog
from mtga.foundation.dataset import PAD, Shard, shard_dir
from mtga.foundation.model import (DraftFM, masked_cross_entropy,
                                   position_features)
from mtga.lands import paths

LOG_EVERY = 50
SPIKE_FACTOR = 3.0


@dataclass
class TrainConfig:
    name: str = "v1_base"
    sets: list = field(default_factory=list)        # (set_code, format) pairs
    seed: int = 17
    batch_size: int = 8192
    lr: float = 1e-3
    warmup_steps: int = 2000
    epochs: float = 4.0                              # presentation budget
    max_steps: int = 0                               # 0 = derive from epochs
    d_model: int = 256
    dropout: float = 0.1
    set_ctx: bool = True
    label_smoothing: float = 0.05
    sampling_alpha: float = 0.5
    val_every: int = 2000
    val_max_picks: int = 200_000
    patience: int = 3
    device: str = "mps"
    parity_check: bool = True


def load_shards(pairs):
    shards = []
    for set_code, limited_type in pairs:
        d = shard_dir(set_code, limited_type)
        assets = np.load(d / "features.npz")
        features = torch.from_numpy(assets["features"].astype(np.float32))
        shard = Shard(set_code, limited_type, features)
        shard.rarity_ids = torch.from_numpy(assets["rarity_ids"].astype(np.int64))
        shard.set_scalars = torch.tensor([
            shard.meta["vocab_size"] / 400.0,
            float(shard.meta.get("picks_per_pack") == 13),
            float(shard.meta.get("picks_per_pack") == 14),
            float(shard.meta.get("picks_per_pack") == 15),
        ])
        shards.append(shard)
    return shards


def make_batch(shard, rows, device):
    raw = shard.gather(rows)
    context = torch.from_numpy(raw["context"].astype(np.int64))
    batch = {
        "pool_slots": torch.from_numpy(raw["pool_slots"].astype(np.int64)),
        "pool_counts": torch.from_numpy(raw["pool_counts"].astype(np.int64)),
        "pack_slots": torch.from_numpy(raw["pack_slots"].astype(np.int64)),
        "pick_pos": torch.from_numpy(raw["pick_pos"].astype(np.int64)),
        "position": position_features(context, shard.meta.get("picks_per_pack") or 14),
        "wr_id": context[:, 2],
        "games_id": context[:, 3],
        "format_id": context[:, 4],
    }
    batch["set_scalars"] = shard.set_scalars.unsqueeze(0).expand(len(rows), -1)
    return {k: v.to(device) for k, v in batch.items()}


def run_steps(model, shards, config, n_steps, device, rng, optimizer=None,
              scheduler=None, watchdog=True, progress=None, state=None):
    """The core loop; returns trailing loss history. state carries counters
    across resumed segments."""
    weights = np.array([len(s.train_idx) for s in shards], dtype=np.float64)
    weights = weights ** config.sampling_alpha
    weights /= weights.sum()

    features = {id(s): s.features.to(device) for s in shards}
    rarities = {id(s): s.rarity_ids.to(device) for s in shards}

    losses = []
    skipped = []
    for step in range(n_steps):
        shard = shards[rng.choice(len(shards), p=weights)]
        rows = np.sort(rng.choice(shard.train_idx, size=min(
            config.batch_size, len(shard.train_idx)), replace=False))
        batch = make_batch(shard, rows, device)
        table, summary = model.encode_set(features[id(shard)], rarities[id(shard)])
        logits = model(table, summary, batch)
        loss = masked_cross_entropy(logits, batch["pick_pos"],
                                    config.label_smoothing)
        if optimizer is not None:
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0).item()
            if math.isfinite(norm):
                optimizer.step()
            else:
                # Transient MPS kernel NaNs happen (documented class). One
                # poisoned step through clip+Adam corrupts weights for good,
                # so we skip the update instead. Frequent skips = real
                # corruption -> halt.
                skipped.append(step)
                optimizer.zero_grad(set_to_none=True)
                print(f"WARNING: non-finite grad norm at step {step}; "
                      f"update skipped ({len(skipped)} total)", flush=True)
                recent = [s for s in skipped if s > step - 500]
                if len(recent) > 5:
                    raise RuntimeError(
                        f"{len(recent)} non-finite grads in 500 steps — halting")
            if scheduler is not None:
                scheduler.step()

        if step % LOG_EVERY == 0 or step == n_steps - 1:
            value = loss.item()  # sync point — keep rare
            if watchdog and math.isfinite(value):
                trailing = np.median(losses[-10:]) if losses else value
                if len(losses) > 10 and value > SPIKE_FACTOR * trailing:
                    raise RuntimeError(
                        f"loss spike at step {step}: {value:.3f} vs median {trailing:.3f}")
            if math.isfinite(value):
                losses.append(value)
            # Non-finite loss falls through: backward yields non-finite grads
            # and the per-step gradient gate below skips the update + counts it.
            if progress and step % (LOG_EVERY * 10) == 0:
                progress(step, value, state)
    return losses


def parity_check(config, shards, batch_size=512, trajectory_steps=20):
    """CPU-vs-device parity on the invariants that actually detect wrong math.

    Long trajectories legitimately diverge (reduction order + dropout RNG
    compound through Adam), so we compare: (1) a single forward loss on an
    identical batch and weights (rel < 1e-4), (2) the global gradient norm of
    one backward (rel < 1e-3), (3) a short dropout-free trajectory
    (rel < 5e-2 — a loose guard against optimizer-step corruption).
    """
    shard = shards[0]
    rows = np.sort(np.random.default_rng(config.seed).choice(
        shard.train_idx, size=min(batch_size, len(shard.train_idx)),
        replace=False))
    report = {}

    def build(device):
        torch.manual_seed(config.seed)
        model = DraftFM(shard.features.shape[1], config.d_model,
                        dropout=0.0, set_ctx=config.set_ctx).to(device)
        return model

    for device in ["cpu", config.device]:
        model = build(device)
        features = shard.features.to(device)
        rarities = shard.rarity_ids.to(device)
        batch = make_batch(shard, rows, device)

        table, summary = model.encode_set(features, rarities)
        loss = masked_cross_entropy(model(table, summary, batch),
                                    batch["pick_pos"], config.label_smoothing)
        loss.backward()
        grad_norm = torch.sqrt(sum(
            (p.grad ** 2).sum() for p in model.parameters()
            if p.grad is not None)).item()

        model.zero_grad(set_to_none=True)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
        final = loss.item()
        for _ in range(trajectory_steps):
            table, summary = model.encode_set(features, rarities)
            step_loss = masked_cross_entropy(
                model(table, summary, batch), batch["pick_pos"],
                config.label_smoothing)
            optimizer.zero_grad(set_to_none=True)
            step_loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            final = step_loss.item()
        report[device] = {"loss": loss.item(), "grad_norm": grad_norm,
                          "trajectory_loss": final}

    cpu, dev = report["cpu"], report[config.device]
    checks = {
        "forward": (abs(cpu["loss"] - dev["loss"]) / max(abs(cpu["loss"]), 1e-9), 1e-4),
        "grad_norm": (abs(cpu["grad_norm"] - dev["grad_norm"])
                      / max(abs(cpu["grad_norm"]), 1e-9), 1e-3),
        "trajectory": (abs(cpu["trajectory_loss"] - dev["trajectory_loss"])
                       / max(abs(cpu["trajectory_loss"]), 1e-9), 5e-2),
    }
    report["checks"] = {k: {"rel": rel, "tol": tol} for k, (rel, tol) in checks.items()}
    # A NaN rel must FAIL, not silently pass a > comparison.
    failed = {k for k, (rel, tol) in checks.items()
              if not math.isfinite(rel) or rel > tol}
    if failed:
        raise RuntimeError(f"CPU/{config.device} parity FAILED ({failed}): {report}")
    return report


@torch.no_grad()
def evaluate_val(model, shards, config, device, rng):
    """Within-training-set val top-1 (early stopping signal — never dev)."""
    model.eval()
    correct = total = 0
    per_shard = max(2048, config.val_max_picks // max(len(shards), 1))
    for shard in shards:
        if not len(shard.val_idx):
            continue
        take = min(per_shard, len(shard.val_idx))
        rows = np.sort(rng.choice(shard.val_idx, size=take, replace=False))
        features = shard.features.to(device)
        rarities = shard.rarity_ids.to(device)
        for start in range(0, take, config.batch_size):
            chunk = rows[start:start + config.batch_size]
            batch = make_batch(shard, chunk, device)
            table, summary = model.encode_set(features, rarities)
            logits = model(table, summary, batch)
            correct += (logits.argmax(1) == batch["pick_pos"]).sum().item()
            total += len(chunk)
    model.train()
    return correct / max(total, 1)


def train(config):
    torch.manual_seed(config.seed)
    rng = np.random.default_rng(config.seed)
    device = config.device
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS not available")

    shards = load_shards(config.sets)
    total_train = sum(len(s.train_idx) for s in shards)
    steps = config.max_steps or int(config.epochs * total_train / config.batch_size)
    run_id = runlog.new_run_id(config.name)
    out_dir = paths.DATA_ROOT / "foundation" / "runs" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    record = {"run_id": run_id, "config": asdict(config),
              "n_train_picks": total_train, "n_shards": len(shards),
              "planned_steps": steps, "torch_version": torch.__version__}

    if config.parity_check:
        record["parity"] = parity_check(config, shards)
        print(f"parity ok: {record['parity']['checks']}")
        if device == "mps":
            torch.mps.empty_cache()

    torch.manual_seed(config.seed)
    rng = np.random.default_rng(config.seed)
    model = DraftFM(shards[0].features.shape[1], config.d_model,
                    config.dropout, config.set_ctx).to(device)
    record["n_params"] = sum(p.numel() for p in model.parameters())
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=config.lr, betas=(0.9, 0.98), weight_decay=0.01)
    assert all(p.is_contiguous() for p in model.parameters())

    def lr_lambda(step):
        if step < config.warmup_steps:
            return step / max(config.warmup_steps, 1)
        progress = (step - config.warmup_steps) / max(steps - config.warmup_steps, 1)
        return 0.01 + 0.99 * 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    best = {"val_top1": -1.0, "step": 0}
    stale = 0
    started = time.time()
    val_rng = np.random.default_rng(config.seed + 1)
    segments = max(steps // config.val_every, 1)

    def progress(step_in_segment, loss_value, state):
        done = state["base"] + step_in_segment
        rate = done * config.batch_size / max(time.time() - started, 1)
        print(f"step {done}/{steps} loss {loss_value:.4f} "
              f"({rate:,.0f} ex/s)", flush=True)

    for segment in range(segments):
        state = {"base": segment * config.val_every}
        run_steps(model, shards, config,
                  min(config.val_every, steps - state["base"]), device, rng,
                  optimizer=optimizer, scheduler=scheduler,
                  progress=progress, state=state)
        val_top1 = evaluate_val(model, shards, config, device, val_rng)
        elapsed = time.time() - started
        print(f"[val] step {(segment+1)*config.val_every} top1 {val_top1:.4f} "
              f"({elapsed/60:.0f} min)", flush=True)
        torch.save({"model": model.state_dict(), "config": asdict(config),
                    "step": (segment + 1) * config.val_every,
                    "val_top1": val_top1},
                   out_dir / "last.pt")
        if val_top1 > best["val_top1"]:
            best = {"val_top1": val_top1, "step": (segment + 1) * config.val_every}
            stale = 0
            torch.save({"model": model.state_dict(), "config": asdict(config),
                        **best}, out_dir / "best.pt")
        else:
            stale += 1
            if stale >= config.patience:
                print(f"early stop after segment {segment + 1}")
                break

    record.update({
        "best_val_top1": best["val_top1"], "best_step": best["step"],
        "wall_clock_s": round(time.time() - started, 1),
        "examples_per_s": round(best["step"] * config.batch_size
                                / max(time.time() - started, 1)),
        "artifacts": {"best": str(out_dir / "best.pt"),
                      "best_sha256": runlog.file_sha256(out_dir / "best.pt")},
    })
    (out_dir / "record.json").write_text(json.dumps(record, indent=2, default=str))
    runlog.append(record)
    return record
