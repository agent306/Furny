"""Shared checks for ``LabelingResult`` objects in tests (Task 19)."""

from app.schemas.labeling import LabelingResult


def checked(result: LabelingResult) -> LabelingResult:
    """``result`` after proving it is a valid wire object: it survives a round trip through its camelCase
    dict and JSON forms unchanged (the constructor alone does not exercise the aliases)."""
    assert LabelingResult.model_validate(result.model_dump(by_alias=True)) == result
    assert LabelingResult.model_validate_json(result.model_dump_json(by_alias=True)) == result
    return result
