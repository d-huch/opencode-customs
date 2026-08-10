from app.repository import save


def register_patient(patient_id, status):
    return save({"id": patient_id, "status": status})
