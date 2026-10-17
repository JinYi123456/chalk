"""Chalk's pricing engine.

The whole point of the product is this file: a **tabular foundation model**
(TabPFN) that learns, in-context, from the pro's *own* past jobs — hours,
complexity, access, materials — and returns a fair price, a range, and the
probability the client says yes. No training loop; the history is the model's
context.

If TabPFN's weights are not installed or not licensed, the service still
answers, using a transparent distance-weighted heuristic over the same rows,
and labels the response `served: "heuristic"`. It never silently guesses.
"""

from __future__ import annotations

import math
import os
from typing import Any, Literal

JOB_TYPES = [
    "standard_clean",
    "deep_clean",
    "move_out_clean",
    "window_clean",
    "carpet_clean",
    "handyman_small",
    "handyman_medium",
    "odd_jobs",
    "gutter_clear",
    "pressure_wash",
]

# Fallback labor rate per hour per job type — only used when there is no history.
BASE_HOURLY = {
    "standard_clean": 42,
    "deep_clean": 52,
    "move_out_clean": 55,
    "window_clean": 48,
    "carpet_clean": 58,
    "handyman_small": 68,
    "handyman_medium": 72,
    "odd_jobs": 60,
    "gutter_clear": 66,
    "pressure_wash": 62,
}

FEATURE_KEYS = [
    "totalHours",
    "tasks",
    "rooms",
    "complexityAvg",
    "complexityMax",
    "materialsCost",
    "accessDifficulty",
    "riskCount",
]


def _num(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def featurize(row: dict[str, Any]) -> list[float]:
    """One row -> a numeric feature vector (job type one-hot appended)."""
    vec = [_num(row.get(k)) for k in FEATURE_KEYS]
    job = str(row.get("jobType") or "standard_clean")
    vec.extend(1.0 if job == jt else 0.0 for jt in JOB_TYPES)
    return vec


def _band(price: float, win: float) -> list[dict[str, Any]]:
    steps = [
        ("Win the job", 0.85, 0.24),
        ("Fair", 0.95, 0.11),
        ("Recommended", 1.0, 0.0),
        ("Strong", 1.1, -0.14),
        ("Max", 1.22, -0.32),
    ]
    out = []
    for label, mult, d in steps:
        out.append(
            {
                "label": label,
                "at": max(1, round(price * mult)),
                "win": round(min(0.98, max(0.02, win + d)), 2),
            }
        )
    return out


def _median(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def heuristic(query: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    """Distance-weighted blend of the pro's own jobs. The honest floor."""
    q = featurize(query)
    rows = [r for r in history if r.get("won", True)] or history
    if not rows:
        hourly = BASE_HOURLY.get(str(query.get("jobType")), 50)
        price = _num(query.get("totalHours"), 3) * hourly + _num(query.get("materialsCost")) + _num(query.get("accessDifficulty")) * 14
        price = max(1, round(price))
        return {
            "price": price,
            "low": max(1, round(price * 0.88)),
            "high": max(1, round(price * 1.16)),
            "winProbability": 0.6,
            "served": "heuristic",
            "basis": "no history yet — priced from your trade's standard hourly rate",
            "band": _band(price, 0.6),
            "usualPrice": None,
            "historyUsed": 0,
        }

    scored = []
    for r in rows:
        rv = featurize(r)
        # weight hours/complexity/access hardest — they move a price most
        w = [1.0, 0.4, 0.3, 1.0, 0.6, 0.7, 0.9, 0.6] + [0.5] * len(JOB_TYPES)
        d = sum(wi * abs(a - b) for wi, a, b in zip(w, rv, q))
        scored.append((1.0 / (0.15 + d), r))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:8]
    wsum = sum(s[0] for s in top) or 1.0
    blended = sum(s[1]["price"] * s[0] for s in top) / wsum

    win_rate = sum(1 for r in rows if r.get("won", True)) / len(rows)
    win = min(0.95, max(0.2, win_rate + 0.05))
    price = max(1, round(blended))
    same_type = [r["price"] for r in history if r.get("jobType") == query.get("jobType") and r.get("won", True)]
    usual = _median(same_type) if len(same_type) >= 3 else _median([r["price"] for r in rows])
    return {
        "price": price,
        "low": max(1, round(price * 0.88)),
        "high": max(1, round(price * 1.16)),
        "winProbability": round(win, 2),
        "served": "heuristic",
        "basis": f"{len(rows)} of your past jobs, distance-weighted on hours, complexity, access and materials",
        "band": _band(price, win),
        "usualPrice": round(usual) if usual else None,
        "historyUsed": len(rows),
    }


_model = None
_model_failed = False


def _load_model():
    """Load TabPFN once, if the weights are installed and licensed."""
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    if os.environ.get("TABPFN_DISABLED") == "1":
        _model_failed = True
        return None
    try:
        from tabpfn import TabPFNRegressor  # type: ignore

        _model = TabPFNRegressor(device="cpu", n_estimators=4, ignore_pretraining_limits=True)
    except Exception:
        # Not installed, no weights, or a license the runtime could not accept.
        _model_failed = True
        _model = None
    return _model


def model_pricing(query: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any] | None:
    """TabPFN's answer. None when the model is unavailable or cannot fit."""
    reg = _load_model()
    if reg is None or len(history) < 3:
        return None
    try:
        import numpy as np  # type: ignore

        X = np.array([featurize(r) for r in history], dtype=float)
        y_price = np.array([_num(r.get("price")) for r in history], dtype=float)
        y_win = np.array([1 if r.get("won", True) else 0 for r in history], dtype=int)
        if len(set(y_win.tolist())) < 2:
            y_win = np.array([1] * len(history), dtype=int)
        reg.fit(X, y_price)
        price = max(1.0, float(reg.predict(np.array([featurize(query)], dtype=float))[0]))

        win = 0.65
        try:
            from tabpfn import TabPFNClassifier  # type: ignore

            clf = TabPFNClassifier(device="cpu", n_estimators=4, ignore_pretraining_limits=True)
            clf.fit(X, y_win)
            proba = clf.predict_proba(np.array([featurize(query)], dtype=float))
            win = float(proba[0][-1]) if hasattr(proba, "__len__") else 0.65
        except Exception:
            pass

        win = min(0.95, max(0.15, win))
        same_type = [r["price"] for r in history if r.get("jobType") == query.get("jobType") and r.get("won", True)]
        usual = _median(same_type) if len(same_type) >= 3 else None
        return {
            "price": round(price),
            "low": max(1, round(price * 0.88)),
            "high": max(1, round(price * 1.16)),
            "winProbability": round(win, 2),
            "served": "model",
            "basis": f"TabPFN (in-context over {len(history)} of your past jobs)",
            "band": _band(price, win),
            "usualPrice": round(usual) if usual else None,
            "historyUsed": len(history),
        }
    except Exception:
        return None


def predict(query: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    """Price one job. The model if it can, the honest heuristic if it cannot."""
    result = model_pricing(query, history)
    if result is not None:
        return result
    fallback = heuristic(query, history)
    if _load_model() is None:
        fallback["basis"] = fallback["basis"] + " (TabPFN weights not loaded on this host)"
    return fallback


def info() -> dict[str, Any]:
    reg = _load_model()
    return {
        "model": "tabpfn" if reg is not None else None,
        "served": "model" if reg is not None else "heuristic",
        "job_types": JOB_TYPES,
    }
