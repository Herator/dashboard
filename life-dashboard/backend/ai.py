import json
import os
from datetime import date, timedelta
from typing import List, Optional, Type

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError, create_model
from sqlmodel import Session, SQLModel, select

from backend.crud import build_input_model
from backend.database import get_session

AI_MODEL_ID = os.environ.get("AI_MODEL_ID", "claude-opus-5")


def get_anthropic_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def _current_week_bounds() -> tuple[date, date]:
    today = date.today()
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)


def make_ai_edit_router(
    model: Type[SQLModel],
    prefix: str,
    tag: str,
    resource_label: str,
    scope_field: Optional[str] = None,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    ItemSchema = build_input_model(model, "AiItem", partial=False, include_id=True)
    ResultSchema = create_model("AiEditResult", items=(List[ItemSchema], ...))

    class AiEditRequest(BaseModel):
        message: str
        date_from: Optional[date] = None
        date_to: Optional[date] = None

    @router.post("/ai-edit", response_model=List[model])
    def ai_edit(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        query = select(model)
        scope_note = ""
        if scope_field:
            default_start, default_end = _current_week_bounds()
            date_from = body.date_from or default_start
            date_to = body.date_to or default_end
            column = getattr(model, scope_field)
            query = query.where(column >= date_from, column <= date_to)
            scope_note = (
                f" You are only shown, and may only affect, entries with "
                f"{scope_field} between {date_from.isoformat()} and "
                f"{date_to.isoformat()} inclusive."
            )

        existing = session.exec(query).all()
        existing_ids = {item.id for item in existing}
        current_json = [item.model_dump(mode="json") for item in existing]

        system_prompt = (
            f"You are the AI editing assistant for the {resource_label} feature of a "
            "personal life dashboard. You will be given the user's current entries as "
            "a JSON array (each has an `id`) and a natural-language request describing "
            "a change. Return the complete updated array of entries reflecting the "
            "request: keep entries unchanged (with their original `id`) unless the "
            "request modifies them, modify entries the request refers to (preserve "
            "their `id`), omit entries the request asks to delete, and add new "
            "entries with `id` set to null for anything new the request asks to "
            "create. Only include entries within what you were given — never invent "
            "entries outside that scope." + scope_note
        )

        try:
            response = client.messages.parse(
                model=AI_MODEL_ID,
                max_tokens=4096,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": (
                            f"Current data: {json.dumps(current_json)}\n\n"
                            f"User request: {body.message}"
                        ),
                    }
                ],
                output_format=ResultSchema,
            )
        except anthropic.APIError as exc:
            raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")
        except ValidationError:
            raise HTTPException(
                status_code=502,
                detail="AI response did not match the expected schema.",
            )

        if getattr(response, "stop_reason", None) == "refusal":
            raise HTTPException(
                status_code=422, detail="The AI declined to process this request."
            )

        returned_items = response.parsed_output.items
        returned_ids = {
            item.id
            for item in returned_items
            if item.id is not None and item.id in existing_ids
        }

        for stale_id in existing_ids - returned_ids:
            stale_row = session.get(model, stale_id)
            if stale_row:
                session.delete(stale_row)

        result_rows = []
        for item in returned_items:
            data = item.model_dump(exclude={"id"})
            if item.id is not None and item.id in existing_ids:
                row = session.get(model, item.id)
                for key, value in data.items():
                    setattr(row, key, value)
            else:
                row = model(**data)
                session.add(row)
            result_rows.append(row)

        session.commit()
        for row in result_rows:
            session.refresh(row)
        return result_rows

    return router
