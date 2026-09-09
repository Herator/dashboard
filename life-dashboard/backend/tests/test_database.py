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
