from typing import Any, Callable, Dict, List, Optional, Tuple, Type, TypeVar

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PydanticField, create_model
from sqlmodel import Session, SQLModel, select

from backend.database import get_session

ModelType = TypeVar("ModelType", bound=SQLModel)


def build_input_model(
    model: Type[SQLModel], suffix: str, partial: bool, include_id: bool = False
) -> Type[BaseModel]:
    """Build a plain Pydantic model mirroring ``model``'s writable fields.

    SQLModel disables Pydantic validation on ``table=True`` classes, so using
    them directly as FastAPI request bodies means nothing is validated or
    coerced on the way in: bad enums and missing fields blow up as 500s deep in
    SQLAlchemy, and wrong-typed values get persisted verbatim and then break
    every subsequent read. These generated schemas restore validation for the
    request body while the table model still serves as the response model.

    ``partial=True`` (for PUT) gives every field a ``None`` default so it may be
    omitted, but deliberately keeps the *original* annotation rather than
    wrapping it in ``Optional``. Combined with ``exclude_unset=True`` in the
    handler that means: omitted fields are left untouched, an explicit ``null``
    is accepted only for columns that are genuinely nullable, and an explicit
    ``null`` for something like ``ingredients: List[str]`` is a 422 instead of a
    NULL written into a non-nullable column.

    ``include_id=True`` prepends an ``id: Optional[int] = None`` field, for
    callers (the AI-edit endpoints) that need the model to echo back which
    existing row an item refers to, with ``None``/omitted meaning "new row".
    """
    fields: Dict[str, Tuple[Any, Any]] = {}
    if include_id:
        fields["id"] = (Optional[int], None)
    for name, info in model.model_fields.items():
        if name == "id":
            continue
        annotation = info.annotation
        if partial:
            fields[name] = (annotation, None)
        elif info.default_factory is not None:
            fields[name] = (
                annotation,
                PydanticField(default_factory=info.default_factory),
            )
        elif info.is_required():
            fields[name] = (annotation, ...)
        else:
            fields[name] = (annotation, info.default)
    return create_model(f"{model.__name__}{suffix}", **fields)


def make_crud_router(
    model: Type[ModelType],
    prefix: str,
    tag: str,
    post_mutation_hook: Optional[Callable[[Session, ModelType], None]] = None,
) -> APIRouter:
    """Build a CRUD router for ``model``.

    ``post_mutation_hook(session, item)``, if given, runs after each successful
    create/update/delete commit (for a delete, ``item`` is the row captured
    before deletion, so its fields remain readable). Only the meal-plan router
    passes one, to auto-sync groceries.
    """
    router = APIRouter(prefix=prefix, tags=[tag])

    # Built once per router, not per request.
    CreateSchema = build_input_model(model, "Create", partial=False)
    UpdateSchema = build_input_model(model, "Update", partial=True)

    @router.post("", response_model=model, include_in_schema=False)
    @router.post("/", response_model=model)
    def create(item: CreateSchema, session: Session = Depends(get_session)):
        row = model(**item.model_dump())
        session.add(row)
        session.commit()
        session.refresh(row)
        if post_mutation_hook is not None:
            post_mutation_hook(session, row)
            session.refresh(row)  # hook's commit expired the row
        return row

    @router.get("", response_model=List[model], include_in_schema=False)
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
    def update(
        item_id: int, updated: UpdateSchema, session: Session = Depends(get_session)
    ):
        item = session.get(model, item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} not found")
        data = updated.model_dump(exclude_unset=True)
        for key, value in data.items():
            setattr(item, key, value)
        session.add(item)
        session.commit()
        session.refresh(item)
        if post_mutation_hook is not None:
            post_mutation_hook(session, item)
            session.refresh(item)  # hook's commit expired the item
        return item

    @router.delete("/{item_id}", status_code=204)
    def delete(item_id: int, session: Session = Depends(get_session)):
        item = session.get(model, item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"{tag} {item_id} not found")
        session.delete(item)
        session.commit()
        if post_mutation_hook is not None:
            post_mutation_hook(session, item)
        return None

    return router
