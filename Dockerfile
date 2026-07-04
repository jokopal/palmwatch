# ---- Build stage ----
FROM python:3.12-slim AS builder

WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements-api.txt

# ---- Runtime stage ----
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev gdal-bin curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
