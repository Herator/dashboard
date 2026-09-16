import logging
from typing import Any, Dict, List, Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError, create_model
from sqlmodel import Session

from backend.database import get_session
from backend.routers.ai import (
    AI_MODEL_ID,
    RESOURCE_REGISTRY,
    AiEditConfig,
    _ask_claude,
    _reconcile,
    _scoped_existing,
    get_anthropic_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])

_ClassifyResult = create_model("ClassifyResult", resource_key=(Optional[str], None))


class VoiceCommandRequest(BaseModel):
    message: str


class VoiceCommandResponse(BaseModel):
    speech: str


def _classify_resource(client: anthropic.Anthropic, message: str) -> Optional[str]:
    """Ask Claude which RESOURCE_REGISTRY key the message is about.

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
        response = client.messages.parse(
            model=AI_MODEL_ID,
            max_tokens=64,
            system=system_prompt,
            messages=[{"role": "user", "content": message}],
            output_format=_ClassifyResult,
        )
    except (anthropic.APIError, ValidationError):
        return None

    if getattr(response, "stop_reason", None) == "refusal":
        return None

    parsed_output = getattr(response, "parsed_output", None)
    if parsed_output is None:
        return None

    resource_key = parsed_output.resource_key
    return resource_key if resource_key in RESOURCE_REGISTRY else None


def _describe_change(
    config: AiEditConfig,
    created: List[Dict[str, Any]],
    updated: List[Dict[str, Any]],
    deleted: List[Dict[str, Any]],
) -> str:
    """Build a short spoken confirmation from what `_reconcile` changed."""
    parts = []
    if created:
        names = ", ".join(str(item.get(config.primary_field, "an item")) for item in created)
        parts.append(f"Added {names} to {config.resource_label}.")
    if updated:
        count = len(updated)
        parts.append(f"Updated {count} item{'s' if count != 1 else ''} in {config.resource_label}.")
    if deleted:
        names = ", ".join(str(item.get(config.primary_field, "an item")) for item in deleted)
        parts.append(f"Removed {names} from {config.resource_label}.")
    if not parts:
        return f"No changes made to {config.resource_label}."
    return " ".join(parts)


@router.post("/api/voice-command", response_model=VoiceCommandResponse)
def voice_command(
    body: VoiceCommandRequest,
    session: Session = Depends(get_session),
    client: anthropic.Anthropic = Depends(get_anthropic_client),
):
    resource_key = _classify_resource(client, body.message)
    if resource_key is None:
        return VoiceCommandResponse(speech="I'm not sure what you meant — try rephrasing.")

    config = RESOURCE_REGISTRY[resource_key]
    existing, scope_note = _scoped_existing(config, None, None, session)
    try:
        returned_items = _ask_claude(client, config, body.message, existing, scope_note)
    except HTTPException:
        return VoiceCommandResponse(
            speech="Something went wrong updating that — try again in a bit."
        )

    created, updated, deleted, _ = _reconcile(
        config, session, existing, returned_items, commit=True, message=body.message
    )
    return VoiceCommandResponse(speech=_describe_change(config, created, updated, deleted))
