<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Identity\Models\User;

/**
 * The cast of the policy tests (13 §8): the project's customer, a stranger, the five staff roles and an
 * inactive admin. Datasets name actors by key because factories cannot run while Pest collects datasets.
 */
final class PolicyActors
{
    /** Every staff role. */
    public const array STAFF = ['staff-owner', 'admin', 'estimator', 'production', 'support'];

    /** The roles holding `plans.edit_any` (13 §7.2). */
    public const array PLAN_EDITORS = ['staff-owner', 'admin', 'estimator'];

    /** The roles holding `customers.manage`, `ai.manage` and the other owner/admin-only permissions. */
    public const array MANAGERS = ['staff-owner', 'admin'];

    /**
     * The expectation vocabulary of the datasets: `true` = allowed; an int = denied with that HTTP
     * status; `null` = denied without a status (what `Gate::before` returns for inactive staff).
     *
     * @return array{bool, int|null}
     */
    public static function outcome(bool|int|null $expected): array
    {
        return match (true) {
            $expected === true => [true, null],
            $expected === null, $expected === false => [false, null],
            default => [false, $expected],
        };
    }

    /**
     * @param  'customer'|'other-customer'|'staff-owner'|'admin'|'estimator'|'production'|'support'|'inactive-admin'|string  $actor
     */
    public static function resolve(string $actor, User $customer): User
    {
        return match ($actor) {
            'customer' => $customer,
            'other-customer' => User::factory()->create(),
            'staff-owner' => User::factory()->owner()->create(),
            'admin' => User::factory()->admin()->create(),
            'estimator' => User::factory()->estimator()->create(),
            'production' => User::factory()->production()->create(),
            'support' => User::factory()->support()->create(),
            'inactive-admin' => User::factory()->admin()->inactive()->create(),
            default => throw new \InvalidArgumentException("Unknown policy actor [{$actor}]."),
        };
    }

    /**
     * Dataset rows `[actor, expectation]` keyed by actor, from an expectation per actor.
     *
     * @param  array<string, bool|int|null>  $expectations
     * @return array<string, array{string, bool|int|null}>
     */
    public static function rows(array $expectations): array
    {
        $rows = [];

        foreach ($expectations as $actor => $expected) {
            $rows[$actor] = [$actor, $expected];
        }

        return $rows;
    }

    /**
     * Expectations of an ability that the customer who owns the record and the staff holding one
     * permission may use: strangers get 404, staff without the permission 403, inactive staff nothing.
     *
     * @param  list<string>  $staffAllowed  staff actors holding the permission
     * @return array<string, bool|int|null>
     */
    public static function ownerOrStaff(array $staffAllowed): array
    {
        $expectations = ['customer' => true, 'other-customer' => 404, 'inactive-admin' => null];

        foreach (self::STAFF as $staff) {
            $expectations[$staff] = in_array($staff, $staffAllowed, true) ? true : 403;
        }

        return $expectations;
    }
}
