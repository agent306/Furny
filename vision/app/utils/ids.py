"""Entity id generator for plan documents (master 6.3): ``{prefix}_{nanoid(10)}``."""

import secrets

ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
ID_LENGTH = 10


def new_id(prefix: str) -> str:
    """Return ``{prefix}_`` followed by 10 random characters from ``[0-9a-z]``."""
    return f"{prefix}_{''.join(secrets.choice(ID_ALPHABET) for _ in range(ID_LENGTH))}"
