"""
Kronos prediction sidecar — FastAPI service that wraps the real
`NeoQuasar/Kronos-{base,mini}` HuggingFace transformer so the Node bot
can POST candles to it and get genuine model forecasts back.

Design choices:
  - Predictors are cached in-process (model load is slow: a few seconds on
    MPS, 100-500 MB checkpoint).
  - `POST /predict` is a pure function of the request payload; repeated
    requests for the same window produce different samples because Kronos
    sampling is stochastic by design (temperature + top_p).
  - One worker only. Inference is GPU/MPS-bound and benefits more from a
    larger `sample_count` per call than from concurrency.
  - The Monte Carlo samples are drawn as ONE batched forward pass (N copies
    of the same window through `predict_batch`), which is several times
    faster than N sequential calls on any accelerator. If batching fails
    for any reason we fall back to the sequential loop.

Run:
  uvicorn server:app --host 127.0.0.1 --port 5005
"""
from __future__ import annotations

import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, List, Literal

import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# -----------------------------------------------------------------------------
# Kronos module resolution
#
# The Kronos inference classes live in a `model/` package. This terminal sits
# inside a fork of the Kronos repo, so the package is normally three folders
# up. KRONOS_REPO_DIR overrides; ./Kronos (a fresh clone) is the fallback.
# -----------------------------------------------------------------------------
_here = os.path.dirname(os.path.abspath(__file__))
_candidates = [
    os.environ.get("KRONOS_REPO_DIR"),
    os.path.abspath(os.path.join(_here, "..", "..", "..")),
    os.path.join(_here, "Kronos"),
]
_repo_dir = next(
    (c for c in _candidates if c and os.path.isfile(os.path.join(c, "model", "kronos.py"))),
    None,
)
if _repo_dir and _repo_dir not in sys.path:
    sys.path.insert(0, _repo_dir)

try:
    from model import Kronos, KronosPredictor, KronosTokenizer  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        f"Could not import the Kronos `model` package (looked in {_candidates!r}). "
        "Run ./bootstrap.sh, or set KRONOS_REPO_DIR to a checkout of "
        "https://github.com/shiyu-coder/Kronos."
    ) from exc


Variant = Literal["base", "mini"]

_PREDICTORS: dict[str, KronosPredictor] = {}


def _hf_ids(variant: Variant) -> tuple[str, str, int]:
    """HuggingFace model + tokenizer ids + max context length for a variant."""
    if variant == "mini":
        return "NeoQuasar/Kronos-mini", "NeoQuasar/Kronos-Tokenizer-2k", 2048
    return "NeoQuasar/Kronos-base", "NeoQuasar/Kronos-Tokenizer-base", 512


def _device() -> str:
    env = os.environ.get("KRONOS_DEVICE")
    if env:
        return env
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def load_predictor(variant: Variant) -> KronosPredictor:
    """Load-and-cache a Kronos predictor for `base` or `mini`."""
    if variant in _PREDICTORS:
        return _PREDICTORS[variant]

    model_id, tok_id, max_context = _hf_ids(variant)
    print(f"[kronos-sidecar] Loading Kronos-{variant} from HuggingFace...", flush=True)
    tokenizer = KronosTokenizer.from_pretrained(tok_id)
    model = Kronos.from_pretrained(model_id)
    model.eval()
    tokenizer.eval()
    predictor = KronosPredictor(model, tokenizer, device=_device(), max_context=max_context)
    _PREDICTORS[variant] = predictor
    print(
        f"[kronos-sidecar] Loaded Kronos-{variant} on {_device()} (max_context={max_context}).",
        flush=True,
    )
    return predictor


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Preload the env-named variant so the first request doesn't stall the
    # whole scan cycle behind a 30s HuggingFace download.
    preload = os.environ.get("KRONOS_VARIANT")
    if preload in ("base", "mini"):
        load_predictor(preload)  # type: ignore[arg-type]
    yield
    _PREDICTORS.clear()


app = FastAPI(title="Kronos Sidecar", version="0.2.0", lifespan=lifespan)


class Candle(BaseModel):
    """One OHLCV candle. Timestamps are unix milliseconds for JSON compactness."""

    timestamp: int = Field(..., description="Candle open time, unix milliseconds (UTC)")
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float = 0.0  # quote-asset turnover; default 0 when missing


class PredictRequest(BaseModel):
    candles: List[Candle]
    variant: Variant = "base"
    horizon_minutes: int = Field(5, ge=1, le=1440)
    temperature: float = 1.0
    top_p: float = 0.9
    sample_count: int = Field(20, ge=1, le=200)


class PredictResponse(BaseModel):
    variant: Variant
    direction: Literal["UP", "DOWN"]
    prob_up: float
    prob_down: float
    confidence: float
    current_close: float
    predicted_close_avg: float
    predicted_change_pct: float
    predictions: List[float]
    prediction_spread: float
    sample_count: int
    duration_ms: int
    batched: bool = True


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "loaded_variants": list(_PREDICTORS.keys()),
        "device": _device(),
        "repo_dir": _repo_dir,
    }


def _sample_closes(
    predictor: KronosPredictor,
    df: pd.DataFrame,
    x_timestamp: pd.Series,
    y_timestamp: pd.Series,
    req: PredictRequest,
) -> tuple[list[float], bool]:
    """Draw `sample_count` independent next-candle closes.

    `predict(sample_count=k)` averages its k samples internally, which would
    destroy the distribution we need. Instead each sample is one series in a
    batch (or one call in a loop), so every close is an independent draw.
    """
    n = req.sample_count
    try:
        outs = predictor.predict_batch(
            df_list=[df] * n,
            x_timestamp_list=[x_timestamp] * n,
            y_timestamp_list=[y_timestamp] * n,
            pred_len=1,
            T=req.temperature,
            top_p=req.top_p,
            sample_count=1,
            verbose=False,
        )
        return [float(o["close"].iloc[0]) for o in outs], True
    except Exception as exc:  # pragma: no cover - depends on device memory
        print(f"[kronos-sidecar] batched sampling failed ({exc}); falling back to a loop", flush=True)

    closes: list[float] = []
    for _ in range(n):
        pred_df = predictor.predict(
            df=df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=1,
            T=req.temperature,
            top_p=req.top_p,
            sample_count=1,
            verbose=False,
        )
        closes.append(float(pred_df["close"].iloc[0]))
    return closes, False


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    """Run Kronos over the supplied candles and return a sampled forecast."""
    t0 = time.time()
    n = len(req.candles)
    if n < 10:
        raise HTTPException(400, f"Need at least 10 candles, got {n}")

    predictor = load_predictor(req.variant)

    # The model is trained on its full context length; short inputs give a
    # degraded forecast (and on some versions a tensor-shape error inside
    # RotaryEmbedding). Reject with a clean 400 so the caller can tell
    # "sidecar is down" from "you sent too few candles".
    max_context = getattr(predictor, "max_context", None) or 512
    if n < max_context:
        raise HTTPException(
            400,
            (
                f"Kronos-{req.variant} requires {max_context} candles of context "
                f"(got {n}). The caller's walk-forward loop should start at "
                f"idx >= {max_context}."
            ),
        )
    candles = req.candles[-max_context:]

    # Kronos expects a 6-column DataFrame (OHLCV + turnover) plus a separate
    # timestamp series.
    df = pd.DataFrame(
        [
            {
                "open": c.open,
                "high": c.high,
                "low": c.low,
                "close": c.close,
                "volume": c.volume,
                "amount": c.amount,
            }
            for c in candles
        ]
    )
    x_timestamp = pd.Series([pd.to_datetime(c.timestamp, unit="ms", utc=True) for c in candles])
    next_ts = x_timestamp.iloc[-1] + pd.Timedelta(minutes=req.horizon_minutes)
    y_timestamp = pd.Series([next_ts])
    current_close = float(df["close"].iloc[-1])

    predictions, batched = _sample_closes(predictor, df, x_timestamp, y_timestamp, req)

    up_count = sum(1 for p in predictions if p >= current_close)
    prob_up = up_count / len(predictions)
    direction: Literal["UP", "DOWN"] = "UP" if prob_up >= 0.5 else "DOWN"
    avg_pred = sum(predictions) / len(predictions)

    return PredictResponse(
        variant=req.variant,
        direction=direction,
        prob_up=prob_up,
        prob_down=1.0 - prob_up,
        confidence=max(prob_up, 1.0 - prob_up),
        current_close=current_close,
        predicted_close_avg=avg_pred,
        predicted_change_pct=((avg_pred - current_close) / current_close) * 100,
        predictions=predictions,
        prediction_spread=max(predictions) - min(predictions),
        sample_count=req.sample_count,
        duration_ms=int((time.time() - t0) * 1000),
        batched=batched,
    )
