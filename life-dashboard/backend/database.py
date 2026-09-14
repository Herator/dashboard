from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, create_engine, Session

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR / 'life_dashboard.db'}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def _add_missing_columns() -> None:
    """Poor-man's migration: add any model column missing from an existing
    table. There's no Alembic setup for this project, and `create_all` only
    creates missing *tables* — it silently ignores columns added to a model
    whose table already exists, which would otherwise 500 on the first
    insert/read after adding a field like `Event.color`. Additive-only (new
    nullable columns): safe for existing rows, which get NULL, and it never
    touches column types or removals.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in SQLModel.metadata.tables.values():
            if table.name not in existing_tables:
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def get_session():
    with Session(engine) as session:
        yield session
