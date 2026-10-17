"""
Contract tests for the sidecar. They run WITHOUT downloading weights: a tiny
randomly-initialised Kronos is injected in place of the HuggingFace model.
Its forecasts are meaningless — these tests check the plumbing (shapes,
the context-length guard, the Monte Carlo probability maths), not skill.

    .venv/bin/python -m pytest -q test_server.py
"""
from __future__ import annotations

import os

os.environ.pop("KRONOS_VARIANT", None)  # don't try to download in lifespan

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient

import server
from model import Kronos, KronosPredictor, KronosTokenizer

CTX = 64


@pytest.fixture(scope="module")
def client():
    torch.manual_seed(0)
    tok = KronosTokenizer(
        d_in=6, d_model=32, n_heads=2, ff_dim=64, n_enc_layers=1, n_dec_layers=1,
        ffn_dropout_p=0.0, attn_dropout_p=0.0, resid_dropout_p=0.0,
        s1_bits=4, s2_bits=4, beta=0.05, gamma0=1.0, gamma=1.1, zeta=0.05, group_size=4,
    )
    model = Kronos(
        s1_bits=4, s2_bits=4, n_layers=1, d_model=32, n_heads=2, ff_dim=64,
        ffn_dropout_p=0.0, attn_dropout_p=0.0, resid_dropout_p=0.0, token_dropout_p=0.0, learn_te=True,
    )
    tok.eval()
    model.eval()
    server._PREDICTORS["base"] = KronosPredictor(model, tok, device="cpu", max_context=CTX)
    with TestClient(server.app) as c:
        yield c
    server._PREDICTORS.clear()


def candles(n: int, start_ms: int = 1_760_000_000_000):
    rng = np.random.default_rng(1)
    px = 60_000 + np.cumsum(rng.normal(0, 20, n))
    out = []
    for i, p in enumerate(px):
        o = float(p)
        c = float(p + rng.normal(0, 10))
        out.append({
            "timestamp": start_ms + i * 300_000,
            "open": o, "high": max(o, c) + 5, "low": min(o, c) - 5, "close": c,
            "volume": float(abs(rng.normal(100, 10))), "amount": 0.0,
        })
    return out


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "base" in body["loaded_variants"]


def test_rejects_short_context(client):
    r = client.post("/predict", json={"candles": candles(CTX - 1), "sample_count": 2})
    assert r.status_code == 400
    assert "requires" in r.json()["detail"]


def test_rejects_too_few(client):
    r = client.post("/predict", json={"candles": candles(5)})
    assert r.status_code == 400


def test_predict_contract(client):
    r = client.post("/predict", json={"candles": candles(CTX + 10), "sample_count": 8, "horizon_minutes": 5})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["sample_count"] == 8
    assert len(d["predictions"]) == 8
    assert 0.0 <= d["prob_up"] <= 1.0
    assert abs(d["prob_up"] + d["prob_down"] - 1.0) < 1e-9
    assert d["confidence"] == max(d["prob_up"], d["prob_down"])
    assert d["direction"] == ("UP" if d["prob_up"] >= 0.5 else "DOWN")
    # prob_up is exactly the share of sampled closes at or above the current close.
    ups = sum(1 for p in d["predictions"] if p >= d["current_close"])
    assert d["prob_up"] == ups / 8
    assert d["prediction_spread"] == pytest.approx(max(d["predictions"]) - min(d["predictions"]))
    assert d["batched"] is True
