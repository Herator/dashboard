# Life Dashboard — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Life Dashboard backend API (FastAPI + SQLite) with generic CRUD for all nine data resources, fully tested, with no frontend, no AI layer, and no external service integrations yet. This is Phase 1a of the Life Dashboard build — later plans add the frontend shell, AI editing, external integrations (Google Calendar, ntfy, package tracking), and Docker/Cloudflare deployment.

**Architecture:** A FastAPI app backed by SQLite via SQLModel (typed ORM models double as request/response schemas). Because all nine resources need the same list/create/get/update/delete shape, a single generic CRUD router factory (`crud.py`) generates the routes for every resource from its SQLModel class, instead of hand-writing nine near-identical router files.

**Tech Stack:** Python 3.11+, FastAPI, SQLModel (SQLAlchemy + Pydantic), SQLite, pytest, httpx (for FastAPI's `TestClient`), uvicorn.

**Spec:** `life-dashboard-spec.md` (repo root) — this plan implements the backend portion of section 3 (Tech Stack), the data model in section 6, plus the new Quick Links resource added to section 4.9 and section 6.

## Global Constraints

- Backend language: Python/FastAPI (spec section 3, decision confirmed).
- Database: SQLite, single file, no Postgres/MySQL (spec section 3).
- No app-level authentication — the API trusts that Cloudflare Access has
  already gated any request that reaches it (spec section 2, decision
  confirmed). Do not add login/session code to this backend.
- Meal slots are exactly four values: `breakfast`, `lunch`, `dinner`,
  `snack` (spec section 8, decision confirmed).
- This backend lives in its own codebase directory (`life-dashboard/`),
  separate from any existing dashboard code, per spec section 1.

---

### Task 1: Repo & Backend Project Scaffold

**Files:**
- Create: `life-dashboard/.gitignore`
- Create: `life-dashboard/backend/requirements.txt`
- Create: `life-dashboard/backend/__init__.py`
- Create: `life-dashboard/backend/database.py`
- Create: `life-dashboard/backend/tests/__init__.py`
- Create: `life-dashboard/backend/tests/test_database.py`
- Create: `life-dashboard/backend/pytest.ini`

**Interfaces:**
- Produces: `database.py` exposes `engine` (SQLAlchemy engine), `init_db()`
  (creates all tables on the configured engine), and `get_session()` (a
  FastAPI dependency generator yielding a `sqlmodel.Session`). Later
  tasks import all three.

- [ ] **Step 1: Initialize git repo (if not already one) and add .gitignore**

Run in the repo root (`C:\Users\herma\Documents\Home-server`):

```bash
git init
```

Create `life-dashboard/.gitignore`:

```
__pycache__/
*.pyc
.venv/
venv/
data/*.db
.env
node_modules/
dist/
```

- [ ] **Step 2: Create requirements.txt**

`life-dashboard/backend/requirements.txt`:

```
fastapi>=0.115,<0.116
uvicorn[standard]>=0.32,<0.33
sqlmodel>=0.0.22,<0.1
pytest>=8.3,<9
httpx>=0.27,<0.28
```

- [ ] **Step 3: Install dependencies into a virtualenv**

```bash
cd life-dashboard/backend
python -m venv .venv
```

On Windows (Git Bash):

```bash
.venv/Scripts/pip install -r requirements.txt
```

- [ ] **Step 4: Create empty package markers**

Create `life-dashboard/backend/__init__.py` (empty file) and
`life-dashboard/backend/tests/__init__.py` (empty file).

- [ ] **Step 5: Write the failing test for database setup**

`life-dashboard/backend/tests/test_database.py`:

```python
from sqlmodel import SQLModel, Session, select

from backend.database import engine, init_db, get_session


def test_init_db_creates_tables_without_error():
    init_db()
    assert engine is not None


def test_get_session_yields_a_working_session():
    init_db()
    gen = get_session()
    session = next(gen)
    assert isinstance(session, Session)
    # clean up the generator
    try:
        next(gen)
    except StopIteration:
        pass
```

- [ ] **Step 6: Create pytest.ini so `backend` is importable as a package**

`life-dashboard/backend/pytest.ini`:

```ini
[pytest]
pythonpath = ..
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
cd life-dashboard/backend
.venv/Scripts/pytest tests/test_database.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.database'`.

- [ ] **Step 8: Write database.py**

`life-dashboard/backend/database.py`:

```python
from pathlib import Path

from sqlmodel import SQLModel, create_engine, Session

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'life_dashboard.db'}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
.venv/Scripts/pytest tests/test_database.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add life-dashboard/.gitignore life-dashboard/backend/requirements.txt \
  life-dashboard/backend/__init__.py life-dashboard/backend/database.py \
  life-dashboard/backend/tests/__init__.py life-dashboard/backend/tests/test_database.py \
  life-dashboard/backend/pytest.ini
git commit -m "$(cat <<'EOF'
feat: scaffold life-dashboard backend project with SQLite setup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 2: Data Models

**Files:**
- Create: `life-dashboard/backend/models.py`
- Create: `life-dashboard/backend/tests/test_models.py`

**Interfaces:**
- Consumes: `database.py`'s `engine`, `init_db()` (Task 1).
- Produces: `models.py` exposes the SQLModel table classes `Event`,
  `MealPlanItem`, `GroceryItem`, `Workout`, `Assignment`, `Exam`,
  `Reminder`, `Package`, `QuickLink`, and the enums `CalendarSource`,
  `MealSlot`, `AssignmentStatus`. All later tasks import these names
  exactly as spelled here.

- [ ] **Step 1: Write the failing test for all models**

`life-dashboard/backend/tests/test_models.py`:

```python
from datetime import date, datetime

from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from backend.models import (
    Event,
    CalendarSource,
    MealPlanItem,
    MealSlot,
    GroceryItem,
    Workout,
    Assignment,
    AssignmentStatus,
    Exam,
    Reminder,
    Package,
    QuickLink,
)


def make_test_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_all_models_round_trip_through_sqlite():
    engine = make_test_engine()
    with Session(engine) as session:
        event = Event(
            source=CalendarSource.self,
            title="Golf",
            start=datetime(2026, 9, 10, 11, 50),
            end=datetime(2026, 9, 10, 13, 0),
        )
        meal = MealPlanItem(
            date=date(2026, 9, 10),
            meal_slot=MealSlot.dinner,
            name="Chicken stir fry",
            ingredients=["chicken", "soy sauce", "broccoli"],
        )
        grocery = GroceryItem(name="Chicken", quantity="2 lb", week_of=date(2026, 9, 8))
        workout = Workout(date=date(2026, 9, 10), plan_text="Rest day")
        assignment = Assignment(
            title="Essay 1",
            course="ENG101",
            due_date=date(2026, 9, 20),
            status=AssignmentStatus.not_started,
        )
        exam = Exam(subject="Calculus", date=date(2026, 10, 1))
        reminder = Reminder(text="Text girlfriend", trigger_time=datetime(2026, 9, 10, 18, 0))
        package = Package(tracking_number="1Z999AA10123456784", carrier="ups")
        link = QuickLink(label="Immich", url="https://photos.example.com")

        session.add_all(
            [event, meal, grocery, workout, assignment, exam, reminder, package, link]
        )
        session.commit()

        for obj in (event, meal, grocery, workout, assignment, exam, reminder, package, link):
            session.refresh(obj)
            assert obj.id is not None

        assert meal.ingredients == ["chicken", "soy sauce", "broccoli"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/Scripts/pytest tests/test_models.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.models'`.

- [ ] **Step 3: Write models.py**

`life-dashboard/backend/models.py`:

```python
from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from sqlmodel import SQLModel, Field, Column, JSON


class CalendarSource(str, Enum):
    self = "self"
    girlfriend = "girlfriend"
    school = "school"


class MealSlot(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class AssignmentStatus(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    done = "done"


class Event(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source: CalendarSource
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    notes: Optional[str] = None


class MealPlanItem(SQLModel, table=True):
    __tablename__ = "meal_plan"

    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    meal_slot: MealSlot
    name: str
    ingredients: List[str] = Field(default_factory=list, sa_column=Column(JSON))


class GroceryItem(SQLModel, table=True):
    __tablename__ = "grocery_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    quantity: Optional[str] = None
    checked: bool = False
    week_of: date


class Workout(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    plan_text: str
    notes: Optional[str] = None


class Assignment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    course: str
    due_date: date
    status: AssignmentStatus = AssignmentStatus.not_started
    notes: Optional[str] = None


class Exam(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    subject: str
    date: date
    notes: Optional[str] = None


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    text: str
    trigger_time: datetime
    sent: bool = False


class Package(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tracking_number: str
    carrier: Optional[str] = None
    status: str = "unknown"
    last_updated: Optional[datetime] = None


class QuickLink(SQLModel, table=True):
    __tablename__ = "quick_links"

    id: Optional[int] = Field(default=None, primary_key=True)
    label: str
    url: str
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/Scripts/pytest tests/test_models.py -v
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add life-dashboard/backend/models.py life-dashboard/backend/tests/test_models.py
git commit -m "$(cat <<'EOF'
feat: add SQLModel data models for all dashboard resources

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 3: Generic CRUD Router Factory

**Files:**
- Create: `life-dashboard/backend/crud.py`
- Create: `life-dashboard/backend/main.py`
- Create: `life-dashboard/backend/tests/conftest.py`
- Create: `life-dashboard/backend/tests/test_crud_factory.py`

**Interfaces:**
- Consumes: `database.py`'s `get_session` (Task 1); `models.py`'s
  `QuickLink` as the resource used to exercise the factory (Task 2).
- Produces: `crud.py` exposes `make_crud_router(model: type[SQLModel],
  prefix: str, tag: str) -> APIRouter` with routes `POST {prefix}/`,
  `GET {prefix}/`, `GET {prefix}/{{item_id}}`, `PUT {prefix}/{{item_id}}`,
  `DELETE {prefix}/{{item_id}}`. `main.py` exposes a FastAPI instance
  named `app`. `tests/conftest.py` exposes pytest fixtures `session` and
  `client` that later test files reuse.

- [ ] **Step 1: Write the failing test for the CRUD factory**

`life-dashboard/backend/tests/conftest.py`:

```python
import pytest
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from backend.database import get_session
from backend.main import app


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(name="client")
def client_fixture(session):
    def get_session_override():
        return session

    app.dependency_overrides[get_session] = get_session_override
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
```

`life-dashboard/backend/tests/test_crud_factory.py`:

```python
def test_create_list_get_update_delete_quick_link(client):
    create_resp = client.post(
        "/api/quick-links/", json={"label": "Immich", "url": "https://photos.example.com"}
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert created["label"] == "Immich"
    link_id = created["id"]

    list_resp = client.get("/api/quick-links/")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    get_resp = client.get(f"/api/quick-links/{link_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["url"] == "https://photos.example.com"

    update_resp = client.put(
        f"/api/quick-links/{link_id}",
        json={"label": "Immich Photos", "url": "https://photos.example.com"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["label"] == "Immich Photos"

    delete_resp = client.delete(f"/api/quick-links/{link_id}")
    assert delete_resp.status_code == 204

    missing_resp = client.get(f"/api/quick-links/{link_id}")
    assert missing_resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/Scripts/pytest tests/test_crud_factory.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.crud'` (or
`backend.main`, whichever import resolves first).

- [ ] **Step 3: Write crud.py**

`life-dashboard/backend/crud.py`:

```python
from typing import List, Type, TypeVar

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from backend.database import get_session

ModelType = TypeVar("ModelType", bound=SQLModel)


def make_crud_router(model: Type[ModelType], prefix: str, tag: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    @router.post("/", response_model=model)
    def create(item: model, session: Session = Depends(get_session)):
        item.id = None
        session.add(item)
        session.commit()
        session.refresh(item)
        return item

    @router.get("/", response_model=List[model])
    def list_all(session: Session = Depends(get_session)):
        return session.exec(select(model)).all()

    @router.get("/{item_id}", response_model=model)
    def get_one(item_id: int, session: Session = Depends(get_session)):
        item = session.get(model, item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} not found")
        return item

    @router.put("/{item_id}", response_model=model)
    def update(item_id: int, updated: model, session: Session = Depends(get_session)):
        item = session.get(model, item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} not found")
        data = updated.dict(exclude_unset=True, exclude={"id"})
        for key, value in data.items():
            setattr(item, key, value)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=204)
    def delete(item_id: int, session: Session = Depends(get_session)):
        item = session.get(model, item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} not found")
        session.delete(item)
        session.commit()
        return None

    return router
```

`life-dashboard/backend/main.py` (minimal for this task — Task 4 adds the
remaining eight routers):

```python
from fastapi import FastAPI

from backend.crud import make_crud_router
from backend.database import init_db
from backend.models import QuickLink

app = FastAPI(title="Life Dashboard API")


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(make_crud_router(QuickLink, "/api/quick-links", "quick-links"))


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/Scripts/pytest tests/test_crud_factory.py -v
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add life-dashboard/backend/crud.py life-dashboard/backend/main.py \
  life-dashboard/backend/tests/conftest.py life-dashboard/backend/tests/test_crud_factory.py
git commit -m "$(cat <<'EOF'
feat: add generic CRUD router factory, prove it out with quick-links

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 4: Wire Up Remaining Eight Resource Routers + Health Check Test

**Files:**
- Modify: `life-dashboard/backend/main.py`
- Create: `life-dashboard/backend/tests/test_routers.py`

**Interfaces:**
- Consumes: `make_crud_router` (Task 3); all model classes from
  `models.py` (Task 2); `client` fixture from `conftest.py` (Task 3).
- Produces: every resource is reachable at
  `/api/events`, `/api/meal-plan`, `/api/groceries`, `/api/workouts`,
  `/api/assignments`, `/api/exams`, `/api/reminders`, `/api/packages`,
  `/api/quick-links`. Later plans (frontend) call these exact paths.

- [ ] **Step 1: Write the failing test for all resource endpoints**

`life-dashboard/backend/tests/test_routers.py`:

```python
import pytest

RESOURCE_PATHS = [
    "/api/events/",
    "/api/meal-plan/",
    "/api/groceries/",
    "/api/workouts/",
    "/api/assignments/",
    "/api/exams/",
    "/api/reminders/",
    "/api/packages/",
    "/api/quick-links/",
]


@pytest.mark.parametrize("path", RESOURCE_PATHS)
def test_resource_list_endpoint_returns_empty_list(client, path):
    resp = client.get(path)
    assert resp.status_code == 200
    assert resp.json() == []


def test_health_check(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/Scripts/pytest tests/test_routers.py -v
```

Expected: FAIL — most paths return 404 since only `/api/quick-links/` is
wired up so far (8 of 9 parametrized cases fail).

- [ ] **Step 3: Wire up the remaining routers in main.py**

Replace the router registration section of
`life-dashboard/backend/main.py`:

```python
from fastapi import FastAPI

from backend.crud import make_crud_router
from backend.database import init_db
from backend.models import (
    Event,
    MealPlanItem,
    GroceryItem,
    Workout,
    Assignment,
    Exam,
    Reminder,
    Package,
    QuickLink,
)

app = FastAPI(title="Life Dashboard API")


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(make_crud_router(Event, "/api/events", "events"))
app.include_router(make_crud_router(MealPlanItem, "/api/meal-plan", "meal-plan"))
app.include_router(make_crud_router(GroceryItem, "/api/groceries", "groceries"))
app.include_router(make_crud_router(Workout, "/api/workouts", "workouts"))
app.include_router(make_crud_router(Assignment, "/api/assignments", "assignments"))
app.include_router(make_crud_router(Exam, "/api/exams", "exams"))
app.include_router(make_crud_router(Reminder, "/api/reminders", "reminders"))
app.include_router(make_crud_router(Package, "/api/packages", "packages"))
app.include_router(make_crud_router(QuickLink, "/api/quick-links", "quick-links"))


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/Scripts/pytest tests/test_routers.py -v
```

Expected: PASS (10 tests: 9 parametrized + health check).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
.venv/Scripts/pytest -v
```

Expected: all tests across all files PASS.

- [ ] **Step 6: Commit**

```bash
git add life-dashboard/backend/main.py life-dashboard/backend/tests/test_routers.py
git commit -m "$(cat <<'EOF'
feat: wire up CRUD routers for all remaining dashboard resources

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 5: Dockerize the Backend

**Files:**
- Create: `life-dashboard/backend/Dockerfile`
- Create: `life-dashboard/docker-compose.yml`

**Interfaces:**
- Consumes: `requirements.txt` (Task 1), `main.py`'s `app` (Task 4).
- Produces: a container image that serves the API on port 8000 inside
  the container, published as `8080:8000` on the host — matching the
  `localhost:8080` placeholder in spec section 2. A later deployment
  plan wires this into the home server's existing Cloudflare Tunnel
  config and, if the server already runs a shared `docker-compose.yml`,
  merges this service into it.

- [ ] **Step 1: Write the Dockerfile**

`life-dashboard/backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Note: the build context for this Dockerfile is `life-dashboard/`
(one level up from the Dockerfile itself), so that `backend.main` is
importable as a package inside the container. This is set via the
`context`/`dockerfile` fields in docker-compose.yml below.

- [ ] **Step 2: Write docker-compose.yml**

`life-dashboard/docker-compose.yml`:

```yaml
services:
  life-dashboard-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8000"
    volumes:
      - life-dashboard-data:/app/data
    restart: unless-stopped

volumes:
  life-dashboard-data:
```

- [ ] **Step 3: Build the image**

```bash
cd life-dashboard
docker compose build
```

Expected: build completes with no errors.

- [ ] **Step 4: Run the container and verify the health endpoint**

```bash
docker compose up -d
curl http://localhost:8080/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 5: Verify a full resource round-trip against the running container**

```bash
curl -X POST http://localhost:8080/api/quick-links/ \
  -H "Content-Type: application/json" \
  -d '{"label": "Immich", "url": "https://photos.example.com"}'
curl http://localhost:8080/api/quick-links/
```

Expected: the POST returns the created record with an `id`, and the GET
returns a list containing it.

- [ ] **Step 6: Tear down**

```bash
docker compose down
```

- [ ] **Step 7: Commit**

```bash
git add life-dashboard/backend/Dockerfile life-dashboard/docker-compose.yml
git commit -m "$(cat <<'EOF'
feat: containerize life-dashboard backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

## Next Plans (not part of this plan)

1. **Frontend shell** — React (Vite) app with one page per resource
   (including a Quick Links tile row on the home page linking to Immich
   and future services), calling the endpoints this plan built.
2. **AI editing layer** — natural-language endpoints per spec section 5,
   calling the Anthropic API server-side.
3. **External integrations** — Google Calendar API / .ics import,
   ntfy for reminders, package tracking API.
4. **Deployment** — merge into the home server's existing Cloudflare
   Tunnel config and Access policy, per spec section 7.
