<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Customers;

/** `admin.customers.anonymise` (14 §9): the owner types ANONYMISE. The gate `data.delete` is route middleware. */
final class AnonymiseCustomerRequest extends CustomerLifecycleRequest
{
    public const string WORD = 'ANONYMISE';

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['confirmation' => ['required', 'string', 'in:'.self::WORD]];
    }
}
