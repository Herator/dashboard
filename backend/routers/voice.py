import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, create_model
from sqlmodel import Session

from backend.database import get_session
from backend.routers.ai import (
    AI_MODEL_ID,
    RESOURCE_REGISTRY,
    AiEditConfig,
    _ask_ai,
    _finish_reason,
    _reconcile,
    _scoped_existing,
    get_ai_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])

# Spoken confirmations are Norwegian — the Siri Shortcut's "Speak Text" step
# uses a Norwegian voice, so English text read through it comes out mangled.
# Only this user-facing speech is translated; RESOURCE_REGISTRY's
# `resource_label` stays English since it also feeds the AI system prompt
# (_ask_ai) and warning logs, which don't need to change.
_RESOURCE_LABEL_NO = {
    "meal-plan": "matplanen",
    "workouts": "treningsplanen",
    "reminders": "påminnelsene",
    "calendar": "kalenderen",
    "groceries": "handlelisten",
    "filament": "filamentlisten",
}

_ClassifyResult = create_model("ClassifyResult", resource_key=(Optional[str], None))


class VoiceCommandRequest(BaseModel):
    message: str


class VoiceCommandResponse(BaseModel):
    speech: str


def _classify_resource(client: genai.Client, message: str) -> Optional[str]:
    """Ask Gemini which RESOURCE_REGISTRY key the message is about.

    Never raises — API errors, refusals, "doesn't match any resource", and a
    hallucinated key that isn't in the registry are all indistinguishable to
    the caller, which reports the same "not sure what you meant" speech for
    all of them.
    """
    options = "\n".join(
        f"- {key}: {config.resource_label}" for key, config in RESOURCE_REGISTRY.items()
    )
    system_prompt = (
        "You route spoken requests for a personal life dashboard to the resource "
        "they're about. Given the user's request, reply with the single "
        "best-matching resource key from this list, or null if none confidently "
        "fit:\n" + options
    )
    try:
        response = client.models.generate_content(
            model=AI_MODEL_ID,
            contents=message,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=64,
                response_mime_type="application/json",
                response_schema=_ClassifyResult,
            ),
        )
    except genai_errors.APIError:
        return None

    if _finish_reason(response) == "SAFETY":
        return None

    parsed = getattr(response, "parsed", None)
    if parsed is None:
        return None

    resource_key = parsed.resource_key
    return resource_key if resource_key in RESOURCE_REGISTRY else None


def _describe_change(
    resource_key: str,
    config: AiEditConfig,
    created: List[Dict[str, Any]],
    updated: List[Dict[str, Any]],
    deleted: List[Dict[str, Any]],
) -> str:
    """Build a short spoken confirmation (Norwegian) from what `_reconcile` changed."""
    label = _RESOURCE_LABEL_NO[resource_key]
    parts = []
    if created:
        names = ", ".join(str(item.get(config.primary_field, "et element")) for item in created)
        parts.append(f"La til {names} i {label}.")
    if updated:
        count = len(updated)
        parts.append(f"Oppdaterte {count} {'element' if count == 1 else 'elementer'} i {label}.")
    if deleted:
        names = ", ".join(str(item.get(config.primary_field, "et element")) for item in deleted)
        parts.append(f"Fjernet {names} fra {label}.")
    if not parts:
        return f"Ingen endringer gjort i {label}."
    return " ".join(parts)


@router.post("/api/voice-command", response_model=VoiceCommandResponse)
def voice_command(
    body: VoiceCommandRequest,
    session: Session = Depends(get_session),
    client: genai.Client = Depends(get_ai_client),
):
    resource_key = _classify_resource(client, body.message)
    if resource_key is None:
        return VoiceCommandResponse(speech="Jeg er ikke sikker på hva du mente — prøv å omformulere.")

    config = RESOURCE_REGISTRY[resource_key]
    existing, scope_note = _scoped_existing(config, None, None, session)
    try:
        returned_items = _ask_ai(client, config, body.message, existing, scope_note)
    except HTTPException:
        return VoiceCommandResponse(
            speech="Noe gikk galt med oppdateringen — prøv igjen om litt."
        )

    created, updated, deleted, _ = _reconcile(
        config, session, existing, returned_items, commit=True, message=body.message
    )
    return VoiceCommandResponse(speech=_describe_change(resource_key, config, created, updated, deleted))
