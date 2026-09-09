def test_create_list_get_update_delete_quick_link(client):
    create_resp = client.post(
        "/api/quick-links/", json={"label": "Immich", "url": "https://photos.example.com"}
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert created["label"] == "Immich"
    link_id = created["id"]

    list_resp = client.get("/api/quick-links/")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    get_resp = client.get(f"/api/quick-links/{link_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["url"] == "https://photos.example.com"

    update_resp = client.put(
        f"/api/quick-links/{link_id}",
        json={"label": "Immich Photos", "url": "https://photos.example.com"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["label"] == "Immich Photos"

    delete_resp = client.delete(f"/api/quick-links/{link_id}")
    assert delete_resp.status_code == 204

    missing_resp = client.get(f"/api/quick-links/{link_id}")
    assert missing_resp.status_code == 404


# --- Request-body validation -------------------------------------------------
# SQLModel turns off Pydantic validation on `table=True` classes, so the CRUD
# factory builds dedicated input schemas. These tests pin that behaviour: bad
# input must be rejected with a 422 *before* it reaches the database, because a
# malformed row breaks every later read of the collection.


def test_post_with_invalid_enum_value_is_rejected(client):
    resp = client.post(
        "/api/meal-plan/",
        json={"date": "2026-09-10", "meal_slot": "brunch", "name": "Waffles"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "meal_slot"]


def test_post_missing_required_field_is_rejected(client):
    resp = client.post(
        "/api/meal-plan/", json={"date": "2026-09-10", "meal_slot": "dinner"}
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"][0]
    assert detail["loc"] == ["body", "name"]
    assert detail["type"] == "missing"


def test_post_with_wrong_type_for_list_field_is_rejected(client):
    resp = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-10",
            "meal_slot": "dinner",
            "name": "Stir fry",
            "ingredients": "nope",
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "ingredients"]


def test_rejected_post_does_not_poison_the_list_endpoint(client):
    """A bad write used to persist and then 500 every later GET of the list."""
    client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-10",
            "meal_slot": "dinner",
            "name": "Stir fry",
            "ingredients": "nope",
        },
    )
    resp = client.get("/api/meal-plan/")
    assert resp.status_code == 200
    assert resp.json() == []


def test_meal_plan_ingredients_round_trip_over_http(client):
    """The JSON column survives a full create -> read cycle through the API."""
    ingredients = ["chicken", "soy sauce", "broccoli"]
    create_resp = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-10",
            "meal_slot": "dinner",
            "name": "Chicken stir fry",
            "ingredients": ingredients,
        },
    )
    assert create_resp.status_code == 200
    meal_id = create_resp.json()["id"]
    assert create_resp.json()["ingredients"] == ingredients

    get_resp = client.get(f"/api/meal-plan/{meal_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["ingredients"] == ingredients

    list_resp = client.get("/api/meal-plan/")
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["ingredients"] == ingredients


def test_omitted_list_field_gets_its_default(client):
    resp = client.post(
        "/api/meal-plan/",
        json={"date": "2026-09-10", "meal_slot": "dinner", "name": "Stir fry"},
    )
    assert resp.status_code == 200
    assert resp.json()["ingredients"] == []


def test_omitted_defaults_are_not_shared_between_rows(client):
    """The generated create schema must not hand every row the same list."""
    first = client.post(
        "/api/meal-plan/",
        json={"date": "2026-09-10", "meal_slot": "dinner", "name": "A"},
    ).json()
    second = client.post(
        "/api/meal-plan/",
        json={"date": "2026-09-10", "meal_slot": "lunch", "name": "B"},
    ).json()

    client.put(f"/api/meal-plan/{first['id']}", json={"ingredients": ["only-first"]})

    assert client.get(f"/api/meal-plan/{first['id']}").json()["ingredients"] == [
        "only-first"
    ]
    assert client.get(f"/api/meal-plan/{second['id']}").json()["ingredients"] == []


def test_client_supplied_id_is_ignored_on_create(client):
    resp = client.post(
        "/api/quick-links/", json={"id": 999, "label": "X", "url": "https://x.example"}
    )
    assert resp.status_code == 200
    assert resp.json()["id"] != 999


# --- Partial update semantics ------------------------------------------------


def test_put_leaves_omitted_fields_untouched(client):
    created = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-11",
            "meal_slot": "lunch",
            "name": "Tacos",
            "ingredients": ["tortillas", "beef"],
        },
    ).json()

    resp = client.put(
        f"/api/meal-plan/{created['id']}", json={"name": "Tacos al pastor"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Tacos al pastor"
    assert body["ingredients"] == ["tortillas", "beef"]
    assert body["meal_slot"] == "lunch"


def test_put_explicit_null_on_non_nullable_field_is_rejected(client):
    """Sending `null` must not write NULL into a non-nullable column."""
    created = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-11",
            "meal_slot": "lunch",
            "name": "Tacos",
            "ingredients": ["tortillas"],
        },
    ).json()

    resp = client.put(f"/api/meal-plan/{created['id']}", json={"ingredients": None})
    assert resp.status_code == 422

    # The row, and the collection, are still readable.
    assert client.get("/api/meal-plan/").status_code == 200
    assert client.get(f"/api/meal-plan/{created['id']}").json()["ingredients"] == [
        "tortillas"
    ]


def test_put_explicit_null_on_nullable_field_clears_it(client):
    created = client.post(
        "/api/workouts/",
        json={"date": "2026-09-10", "plan_text": "Rest day", "notes": "easy"},
    ).json()

    resp = client.put(f"/api/workouts/{created['id']}", json={"notes": None})
    assert resp.status_code == 200
    assert resp.json()["notes"] is None
    assert resp.json()["plan_text"] == "Rest day"


def test_put_with_invalid_enum_value_is_rejected(client):
    created = client.post(
        "/api/meal-plan/",
        json={"date": "2026-09-11", "meal_slot": "lunch", "name": "Tacos"},
    ).json()

    resp = client.put(f"/api/meal-plan/{created['id']}", json={"meal_slot": "brunch"})
    assert resp.status_code == 422


# --- Collection routes work with and without the trailing slash --------------


def test_collection_routes_work_without_trailing_slash(client):
    """No 307 redirect: some HTTP clients drop the body when following one."""
    create_resp = client.post(
        "/api/quick-links",
        json={"label": "Immich", "url": "https://photos.example.com"},
        follow_redirects=False,
    )
    assert create_resp.status_code == 200

    list_resp = client.get("/api/quick-links", follow_redirects=False)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1


def test_collection_routes_work_with_trailing_slash(client):
    create_resp = client.post(
        "/api/quick-links/",
        json={"label": "Immich", "url": "https://photos.example.com"},
        follow_redirects=False,
    )
    assert create_resp.status_code == 200

    list_resp = client.get("/api/quick-links/", follow_redirects=False)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1
