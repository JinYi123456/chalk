"""Chalk's quote voice as a trainable artifact.

A general model writes generic quotes. This script distils the pro's own
accepted-job corpus into context -> quote-message pairs and fine-tunes a small
open-weight model over Thinking Machines' Tinker, so the sampler in
`services/agent/src/lib/tinker.ts` writes in this pro's voice.

The prompt contract is shared with the agent: system = the Chalk voice brief,
user = "WRITE THE QUOTE MESSAGE\n{json context}", assistant = the message.

    pip install tinker
    export TINKER_API_KEY=...
    python services/tinker/train_voice.py --dry-run     # build the dataset only
    python services/tinker/train_voice.py               # real fine-tune

It is env-gated on purpose: without a key it exits cleanly and the product
keeps its built-in voice. Nothing here is required for Chalk to work.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"

SYSTEM = (
    "You write ONE client message for a solo home-service pro's quote. Voice: warm, plain, "
    "confident, first person. No corporate filler, no \"don't hesitate\", no emojis. 60-120 words. "
    "Say what you will do, the total, what you assumed, and the validity window."
)
USER_PREFIX = "WRITE THE QUOTE MESSAGE"


def build_dataset() -> list[dict]:
    """context -> message pairs from the frozen persona corpus."""
    pairs = json.loads((DATA / "voice_corpus.json").read_text(encoding="utf-8"))
    out = []
    for row in pairs:
        ctx = row["context"]
        user = f"{USER_PREFIX}\n{json.dumps(ctx, separators=(',', ':'))}"
        out.append(
            {
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": user},
                    {"role": "assistant", "content": row["message"]},
                ]
            }
        )
    return out


def write_jsonl(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def train(rows: list[dict], base_model: str, rank: int, steps: int) -> None:
    try:
        import tinker
        from tinker import types
    except Exception as exc:  # pragma: no cover - only runs with the SDK present
        print(f"tinker SDK not available ({exc}); dataset written, fine-tune skipped.")
        return

    service = tinker.ServiceClient()
    client = service.create_lora_training_client(base_model=base_model, rank=rank)
    print(f"training {base_model} (rank {rank}) on {len(rows)} pairs")

    def datum(messages: list[dict]):
        # Behaviour cloning over the whole rendered turn: the target is the
        # sequence shifted by one, so every token is predicted from the ones
        # before it. Weighting the prompt tokens at 0 would train the reply
        # only, but the corpus is four pairs — the point is the voice, not the
        # token budget.
        rendered = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
        ids = client.get_tokenizer().encode(rendered)
        return types.Datum(
            model_input=types.ModelInput.from_ints(list(ids)),
            loss_fn_inputs={"target_tokens": list(ids[1:]) + [int(ids[0])], "weights": [1.0] * len(ids)},
        )

    for step in range(steps):
        batch = []
        for row in rows:
            batch.append(datum(row["messages"]))
            if len(batch) >= 4:
                client.forward_backward(batch, loss_fn="cross_entropy")
                client.optim_step(types.AdamParams(learning_rate=6e-5))
                batch = []
        if batch:
            client.forward_backward(batch, loss_fn="cross_entropy")
            client.optim_step(types.AdamParams(learning_rate=6e-5))
        print(f"step {step + 1}/{steps}", flush=True)

    state = client.save_state(name="chalk-quote-voice").result()
    sampler = client.save_weights_for_sampler(name="chalk-quote-voice").result()
    print(f"state   {state.path}")
    print(f"sampler {sampler.path}")
    print(f"Set TINKER_SAMPLER_PATH={sampler.path} and the agent writes quotes in this voice.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-model", default=os.environ.get("TINKER_BASE_MODEL", "Qwen/Qwen3-8B"))
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--steps", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = build_dataset()
    out = DATA / "voice_dataset.jsonl"
    write_jsonl(rows, out)
    print(f"wrote {len(rows)} training pairs to {out}")

    if args.dry_run or not os.environ.get("TINKER_API_KEY"):
        print("TINKER_API_KEY not set or --dry-run: dataset only, no fine-tune.")
        return 0
    train(rows, args.base_model, args.rank, args.steps)
    return 0


if __name__ == "__main__":
    sys.exit(main())
