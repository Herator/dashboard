def test_cors_allows_configured_frontend_origin(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
