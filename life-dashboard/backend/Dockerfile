FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copied into a nested "backend" package directory (rather than flattened
# into /app) because main.py uses absolute imports like
# `from backend.crud import ...`, so a top-level "backend" package must
# exist on the Python path for `backend.main:app` to be importable.
COPY . ./backend

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
