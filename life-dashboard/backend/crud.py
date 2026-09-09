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
