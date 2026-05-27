import re


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 10:
        return "1" + digits
    return digits


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def find_lead_index(leads: list[dict], incoming: dict) -> int | None:
    incoming_phone = normalize_phone(incoming.get("phone", ""))
    incoming_email = normalize_email(incoming.get("email", ""))
    incoming_name = normalize_name(incoming.get("full_name", ""))

    if incoming_phone:
        for index, lead in enumerate(leads):
            if normalize_phone(lead.get("phone", "")) == incoming_phone:
                return index

    if incoming_email:
        for index, lead in enumerate(leads):
            if normalize_email(lead.get("email", "")) == incoming_email:
                return index

    if incoming_name:
        for index, lead in enumerate(leads):
            if normalize_name(lead.get("full_name", "")) == incoming_name:
                return index

    return None
