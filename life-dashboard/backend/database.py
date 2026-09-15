from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, create_engine, Session

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'life_dashboard.db'}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def _sync_columns() -> None:
    """Poor-man's migration: reconcile each table's columns with its model.

    There's no Alembic setup for this project, and `create_all` only creates
    missing *tables* — it silently ignores a model's columns changing on a
    table that already exists. Missing columns are added (nullable, so
    existing rows read back as NULL); columns no longer on the model are
    dropped, since a stale NOT NULL column left behind by a removed field
    (e.g. `FilamentSpool.remaining_pct`) otherwise 500s on every future
    insert that doesn't set it. Never touches a column that still exists on
    the model, so type changes on kept columns aren't handled here.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in SQLModel.metadata.tables.values():
            if table.name not in existing_tables:
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
            model_columns = {column.name for column in table.columns}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
            for stale in existing_columns - model_columns:
                conn.execute(text(f'ALTER TABLE "{table.name}" DROP COLUMN "{stale}"'))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _sync_columns()


def get_session():
    with Session(engine) as session:
        yield session
