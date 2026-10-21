<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Customers;

use App\Domain\Identity\Models\User;

/** `admin.customers.restore` (14 §9): the customer is deleted and not anonymised. The 30 days are checked by `RestoreDeletedAccount`. */
final class RestoreCustomerRequest extends CustomerLifecycleRequest
{
    public function customer(): User
    {
        $customer = parent::customer();

        abort_unless($customer->trashed(), 404);

        return $customer;
    }
}
