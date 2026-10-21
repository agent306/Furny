<?php

declare(strict_types=1);

namespace App\Support\Http;

use Illuminate\Validation\ValidationException;

/**
 * A domain refusal that is a validation error with a machine code (14 §1.8, §1.9), e.g. `staff.last_owner`. A form gets
 * the errors bag: the message under the field it belongs to (`_error` when no field applies) and the code under
 * `code`. A JSON client gets `422 {code, message, errors}`.
 */
final class CodedValidationException extends ValidationException
{
    /** The error key of a refusal that belongs to no field of the form. */
    public const string NO_FIELD = '_error';

    public string $errorCode = 'validation_failed';

    public static function make(string $code, string $message, string $field = self::NO_FIELD): self
    {
        $exception = self::withMessages([$field => $message, 'code' => $code]);
        $exception->errorCode = $code;

        return $exception;
    }

    /**
     * The messages by field, without the code.
     *
     * @return array<string, list<string>>
     */
    public function fieldErrors(): array
    {
        return array_diff_key($this->errors(), ['code' => true]);
    }
}
