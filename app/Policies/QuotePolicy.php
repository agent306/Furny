<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Policies\Concerns\ChecksOrderOwnership;
use Illuminate\Auth\Access\Response;

/**
 * 13 §8.6. A customer owns a quote through its order; a draft quote is staff-internal, so its customer
 * is told 404 for every ability. Whether the quote can still be accepted, declined or negotiated is the state
 * machine's call (09, P7).
 */
final class QuotePolicy
{
    use ChecksOrderOwnership;

    public function view(User $user, Quote $quote): Response
    {
        return $this->ownerOrStaffCan($user, $quote, PermissionName::OrdersView);
    }

    public function downloadPdf(User $user, Quote $quote): Response
    {
        return $this->view($user, $quote);
    }

    /** Cost snapshot, margins and internal notes. */
    public function viewCosts(User $user, Quote $quote): Response
    {
        return $this->staffCanOnly($user, $quote, PermissionName::QuotesViewCosts);
    }

    public function create(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::QuotesCreate);
    }

    /** Drafts only: a sent quote is what the customer saw and is changed by a new draft. */
    public function update(User $user, Quote $quote): Response
    {
        return $this->draftOnly($user, $quote);
    }

    public function delete(User $user, Quote $quote): Response
    {
        return $this->draftOnly($user, $quote);
    }

    public function send(User $user, Quote $quote): Response
    {
        return $this->staffCanOnly($user, $quote, PermissionName::QuotesSend);
    }

    public function accept(User $user, Quote $quote): Response
    {
        return $this->ownerOnly($user, $quote);
    }

    public function negotiate(User $user, Quote $quote): Response
    {
        return $this->ownerOnly($user, $quote);
    }

    public function decline(User $user, Quote $quote): Response
    {
        return $this->ownerOnly($user, $quote);
    }

    private function draftOnly(User $user, Quote $quote): Response
    {
        $response = $this->staffCanOnly($user, $quote, PermissionName::QuotesCreate);

        if ($response->denied() || $quote->status === QuoteStatus::Draft) {
            return $response;
        }

        return Response::denyWithStatus(422, trans_icu('quotes.errors.not_draft'), 'quote_not_draft');
    }
}
