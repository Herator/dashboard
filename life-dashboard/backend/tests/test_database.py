from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, select

import backend.database as database_module
from backend.database import engine, init_db, get_session
from backend.models import FilamentSpool


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


def test_init_db_drops_columns_removed_from_a_model(monkeypatch):
    # Reproduces a real deployment: FilamentSpool.remaining_pct existed, got
    # dropped from the model, and its stale NOT NULL column in an existing
    # table then broke every insert that no longer sets it.
    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    monkeypatch.setattr(database_module, "engine", test_engine)

    SQLModel.metadata.create_all(test_engine)
    with test_engine.begin() as conn:
        conn.execute(text("ALTER TABLE filament_spools ADD COLUMN remaining_pct INTEGER NOT NULL DEFAULT 100"))
        conn.execute(
            text(
                "INSERT INTO filament_spools (material, color_name, color_hex, weight_total_g, remaining_pct) "
                "VALUES ('PLA', 'Red', '#ff0000', 1000, 80)"
            )
        )

    database_module.init_db()

    columns = {col["name"] for col in inspect(test_engine).get_columns("filament_spools")}
    assert "remaining_pct" not in columns

    with Session(test_engine) as session:
        existing = session.exec(select(FilamentSpool)).one()
        assert existing.material == "PLA"

        # The insert that used to 500 on the leftover NOT NULL column.
        session.add(FilamentSpool(material="PETG", color_name="Black", color_hex="#000000"))
        session.commit()
