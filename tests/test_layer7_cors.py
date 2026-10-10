from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_local_dashboard_private_network_preflight_is_allowed():
    response = client.options(
        "/dashboard/businesses",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
            "Access-Control-Request-Private-Network": "true",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert response.headers["access-control-allow-private-network"] == "true"


def test_private_network_preflight_remains_blocked_for_untrusted_origin():
    response = client.options(
        "/dashboard/businesses",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
            "Access-Control-Request-Private-Network": "true",
        },
    )

    assert response.status_code == 400
    assert "Disallowed CORS origin" in response.text
