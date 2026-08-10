from app.service import register_patient


def post_patient(payload):
    return {"status": 201, "patient": register_patient(payload["id"], payload["status"])}
