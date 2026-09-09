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
