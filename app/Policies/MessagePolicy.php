<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Enums\OrderStateKey;
use App\Domain\Orders\Models\Order;
use App\Policies\Concerns\ChecksOrderOwnership;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\Response;

/**
 * 13 §8.8, 09 §2. One thread per order; a customer reaches it through the order they own.
 */
final class MessagePolicy
{
    use ChecksOrderOwnership;

    /** A cancelled or closed order takes no customer or staff reply once its thread has been closed this many days. */
    private const int THREAD_CLOSED_AFTER_DAYS = 90;

    /** The author may change or delete a text message while it is less than this many minutes old. */
    private const int EDIT_WINDOW_MINUTES = 10;

    /** Internal notes are filtered out of the customer's thread by the query, not here. */
    public function viewThread(User $user, Order $order): Response
    {
        return $this->ownerOrStaffCan($user, $order, PermissionName::OrdersView);
    }

    /**
     * A text message: from the order's customer (verified contact) or staff with `messages.post`. Checked
     * in this order: access (404/403), a closed thread (422 `thread_closed`), the contact (403
     * `contact_unverified`). Verifying cannot reopen a closed thread, so that is told first.
     */
    public function create(User $user, Order $order): Response
    {
        $own = $this->ownsOrder($user, $order);

        if (! $own && ! $this->staffCan($user, PermissionName::MessagesPost)) {
            return $this->allowOrDeny(false, $user);
        }

        if ($this->isThreadClosed($order)) {
            return Response::denyWithStatus(422, trans_icu('messages.errors.thread_closed'), 'thread_closed');
        }

        if ($own && ! $user->hasVerifiedContact()) {
            return Response::denyWithStatus(403, trans_icu('common.verify_required'), 'contact_unverified');
        }

        return Response::allow();
    }

    /** Open to staff even when the customer's thread is closed. */
    public function createInternalNote(User $user, Order $order): Response
    {
        return $this->staffCanOnly($user, $order, PermissionName::MessagesPost);
    }

    /** Edit. Only the author, only a `text` message, only within the window: 422 `edit_window` after it. */
    public function update(User $user, Message $message): Response
    {
        $response = $this->authorOfText($user, $message);

        if ($response->denied()) {
            return $response;
        }

        // `created_at > now() - 10 min` (13 §8.8): a message exactly ten minutes old can no longer be changed.
        if ($message->created_at === null || $message->created_at->lte(CarbonImmutable::now()->subMinutes(self::EDIT_WINDOW_MINUTES))) {
            return Response::denyWithStatus(422, trans_icu('messages.errors.edit_window'), 'edit_window');
        }

        return Response::allow();
    }

    /** Delete is a soft delete, shown as "Message deleted"; same rules as the edit. */
    public function delete(User $user, Message $message): Response
    {
        return $this->update($user, $message);
    }

    /** The author, who still has the right to write in the thread, of a `text` message. */
    private function authorOfText(User $user, Message $message): Response
    {
        $order = $this->orderOf($message);
        $own = $this->ownsOrder($user, $order);
        $mayWrite = $own || $this->staffCan($user, PermissionName::MessagesPost);

        return $this->allowOrDeny($mayWrite && $message->author_id === $user->id && $message->kind === MessageKind::Text, $user, $own);
    }

    /** Cancelled or closed for more than 90 days (to the second, so exactly 90 days is still open); no timestamp counts as closed. */
    private function isThreadClosed(Order $order): bool
    {
        $key = $order->state->key();

        if ($key !== OrderStateKey::Cancelled && $key !== OrderStateKey::Closed) {
            return false;
        }

        $closedAt = $key === OrderStateKey::Cancelled ? $order->cancelled_at : $order->closed_at;

        // A terminal order without its timestamp should not exist; it fails closed rather than staying open for ever.
        return $closedAt === null || $closedAt->lt(CarbonImmutable::now()->subDays(self::THREAD_CLOSED_AFTER_DAYS));
    }
}
