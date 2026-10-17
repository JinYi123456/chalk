"""HTTP surface for Chalk's pricing engine."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from . import service

app = FastAPI(title="chalk-pricing", version="0.1.0")


class Query(BaseModel):
    jobType: str = "standard_clean"
    totalHours: float = 3
    tasks: int = 3
    rooms: int = 2
    complexityAvg: float = 3
    complexityMax: float = 3
    materialsCost: float = 10
    accessDifficulty: float = 0
    riskCount: float = 0


class PredictBody(BaseModel):
    query: Query
    history: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, Any]:
    info = service.info()
    return {"ok": True, "service": "chalk-pricing", **info}


@app.get("/model")
def model() -> dict[str, Any]:
    return service.info()


@app.post("/predict")
def predict(body: PredictBody) -> dict[str, Any]:
    return service.predict(body.query.model_dump(), body.history)
