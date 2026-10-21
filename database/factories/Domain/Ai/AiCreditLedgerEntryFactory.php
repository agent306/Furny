<?php

declare(strict_types=1);

namespace Database\Factories\Domain\Ai;

use App\Domain\Ai\Enums\CreditLedgerKind;
use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Identity\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default: a signup grant of 3 credits to a new customer (02 §7.1, 18 §10.1). One state per kind,
 * each with the sign and default amount of 18 §9.1; link an import with `->for($import, 'reference')`
 * and an admin with `by()`.
 *
 * @extends Factory<AiCreditLedgerEntry>
 */
final class AiCreditLedgerEntryFactory extends Factory
{
    protected $model = AiCreditLedgerEntry::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'delta' => 3,
            'kind' => CreditLedgerKind::SignupGrant,
        ];
    }

    /** The staff member who made a manual grant, revoke or refund, and their reason. */
    public function by(User $staff, string $note): static
    {
        return $this->state(['created_by' => $staff->id, 'note' => $note]);
    }

    /** The top-up of one period (`YYYY-MM`, default the current month); a zero delta is the period marker of 18 §10.2. */
    public function monthlyGrant(?string $period = null, int $delta = 3): static
    {
        return $this->state([
            'kind' => CreditLedgerKind::MonthlyGrant,
            'delta' => $delta,
            'period' => $period ?? now()->format('Y-m'),
        ]);
    }

    public function signupGrant(int $delta = 3): static
    {
        return $this->state(['kind' => CreditLedgerKind::SignupGrant, 'delta' => $delta]);
    }

    public function adminGrant(int $delta = 5): static
    {
        return $this->state(['kind' => CreditLedgerKind::AdminGrant, 'delta' => $delta]);
    }

    public function adminRevoke(int $delta = -2): static
    {
        return $this->state(['kind' => CreditLedgerKind::AdminRevoke, 'delta' => $delta]);
    }

    public function reservation(int $delta = -1): static
    {
        return $this->state(['kind' => CreditLedgerKind::Reservation, 'delta' => $delta]);
    }

    public function reservationRelease(int $delta = 1): static
    {
        return $this->state(['kind' => CreditLedgerKind::ReservationRelease, 'delta' => $delta]);
    }

    public function consumption(int $delta = -1): static
    {
        return $this->state(['kind' => CreditLedgerKind::Consumption, 'delta' => $delta]);
    }

    public function refund(int $delta = 1): static
    {
        return $this->state(['kind' => CreditLedgerKind::Refund, 'delta' => $delta]);
    }
}
