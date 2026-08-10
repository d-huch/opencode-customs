records = {}


def save(record):
    records[record["id"]] = record
    return record
