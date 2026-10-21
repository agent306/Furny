<?php

declare(strict_types=1);

namespace App\Http\Requests\Admin\Customers;

use App\Domain\Identity\Models\User;
use Illuminate\Foundation\Http\FormRequest;

/** A request about one customer, `{user}` of `admin.customers.*` (14 §1.6): staff and anybody else are a 404. The permission or gate is route middleware. */
abstract class CustomerLifecycleRequest extends FormRequest
{
    public function authorize(): bool
    {
        $this->customer();

        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [];
    }

    public function customer(): User
    {
        $customer = $this->route('user');

        abort_unless($customer instanceof User && $customer->isCustomer(), 404);

        return $customer;
    }

    public function actor(): User
    {
        $actor = $this->user();

        return $actor instanceof User ? $actor : abort(403);
    }
}
