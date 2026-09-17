from typing import Optional

from backend.crud import build_input_model
from backend.models import QuickLink


def test_build_input_model_without_id_matches_prior_behavior():
    CreateSchema = build_input_model(QuickLink, "TestCreate", partial=False)
    instance = CreateSchema(label="Immich", url="https://photos.example.com")
    assert instance.label == "Immich"
    assert not hasattr(instance, "id")


def test_build_input_model_with_id_includes_optional_id_field():
    ItemSchema = build_input_model(QuickLink, "TestItem", partial=False, include_id=True)
    with_id = ItemSchema(id=5, label="Immich", url="https://photos.example.com")
    assert with_id.id == 5

    without_id = ItemSchema(label="Router", url="https://192.168.1.1")
    assert without_id.id is None
