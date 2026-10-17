from app import service


def q(**kw):
    base = {
        "jobType": "deep_clean",
        "totalHours": 5,
        "tasks": 5,
        "rooms": 3,
        "complexityAvg": 3.5,
        "complexityMax": 4,
        "materialsCost": 18,
        "accessDifficulty": 0,
        "riskCount": 1,
    }
    base.update(kw)
    return base


def row(price, won=True, job="deep_clean", hours=5, complexity=3.5):
    return {
        "jobType": job,
        "totalHours": hours,
        "tasks": 5,
        "rooms": 3,
        "complexityAvg": complexity,
        "complexityMax": 4,
        "materialsCost": 18,
        "accessDifficulty": 0,
        "riskCount": 1,
        "price": price,
        "won": won,
    }


def test_no_history_falls_back_to_prior():
    out = service.predict(q(), [])
    assert out["served"] == "heuristic"
    assert out["price"] > 0
    assert out["historyUsed"] == 0


def test_heuristic_tracks_history_prices():
    history = [row(250), row(260), row(240), row(255)]
    out = service.predict(q(), history)
    assert 200 <= out["price"] <= 320
    assert out["low"] < out["price"] < out["high"]
    assert 0 < out["winProbability"] <= 1


def test_band_is_a_ladder():
    out = service.predict(q(), [row(300)] * 5)
    prices = [b["at"] for b in out["band"]]
    assert prices == sorted(prices)
    wins = [b["win"] for b in out["band"]]
    assert wins == sorted(wins, reverse=True)


def test_more_hours_costs_more():
    history = [row(150, hours=2), row(300, hours=6), row(240, hours=4), row(200, hours=3)]
    small = service.predict(q(totalHours=2), history)
    big = service.predict(q(totalHours=6), history)
    assert big["price"] > small["price"]


def test_usual_price_prefers_same_job_type():
    history = [row(500, job="move_out_clean")] * 4 + [row(200, job="deep_clean")] * 4
    out = service.predict(q(jobType="deep_clean"), history)
    assert out["usualPrice"] is not None
    assert out["usualPrice"] < 400


def test_featurize_is_deterministic_and_sized():
    a = service.featurize(q())
    b = service.featurize(q())
    assert a == b
    assert len(a) == len(service.FEATURE_KEYS) + len(service.JOB_TYPES)


def test_respects_zero_and_garbage():
    out = service.predict(q(totalHours=0, materialsCost="nope"), [])
    assert out["price"] >= 1
