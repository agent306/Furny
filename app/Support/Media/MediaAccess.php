<?php

declare(strict_types=1);

namespace App\Support\Media;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Identity\Enums\PermissionName;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Enums\ProductionVisibility;
use App\Domain\Orders\Models\Delivery;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderIssue;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\Models\Quote;
use App\Domain\Projects\Models\Plan;
use App\Policies\Concerns\AuthorizesStaff;
use Illuminate\Auth\Access\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Who may open a private file (13 §8.9): the rule of its owner model and collection. A pair the table does not list,
 * which includes every public-disk collection, is not served here. A refusal is a 404 for customers, so the file's
 * existence stays unknown, and a 403 for staff.
 */
final class MediaAccess
{
    use AuthorizesStaff;

    public function authorize(User $user, Media $media): void
    {
        $response = $this->decide($user, $media);

        if ($response === null) {
            abort(404);
        }

        if ($response->denied()) {
            abort($user->isCustomer() ? 404 : 403);
        }
    }

    /** `null` for a combination that is not served at all. */
    private function decide(User $user, Media $media): ?Response
    {
        $subject = $media->model;
        $collection = $media->collection_name;
        $gate = Gate::forUser($user);

        return match (true) {
            $subject instanceof Plan && $collection === 'thumbnail',
            $subject instanceof FurnitureDesign && $collection === 'thumbnail',
            $subject instanceof BlueprintImport && in_array($collection, ['source', 'normalized', 'pages'], true) => $gate->inspect('view', $subject),
            $subject instanceof BlueprintImport && $collection === 'debug' => $gate->inspect('viewDebug', $subject),
            $subject instanceof FurnitureRevision && $collection === 'cutlist_pdf' => $this->staffCan($user, PermissionName::OrdersView) ? Response::allow() : Response::deny(),
            $subject instanceof Quote && $collection === 'pdf' => $gate->inspect('downloadPdf', $subject),
            $subject instanceof ProductionUpdate && $collection === 'photos' => $this->productionPhoto($user, $subject),
            ($subject instanceof OrderIssue || $subject instanceof Delivery) && $collection === 'photos' => $this->orderOf($subject, static fn (Order $order): Response => $gate->inspect('view', $order)),
            $subject instanceof Message && $collection === 'attachments' => $this->messageAttachment($user, $subject),
            default => null,
        };
    }

    /** The order's `view`, and for an internal update `viewInternal` too. */
    private function productionPhoto(User $user, ProductionUpdate $update): ?Response
    {
        return $this->orderOf($update, static function (Order $order) use ($user, $update): Response {
            $gate = Gate::forUser($user);
            $view = $gate->inspect('view', $order);

            return $view->denied() || $update->visibility === ProductionVisibility::Customer ? $view : $gate->inspect('viewInternal', $order);
        });
    }

    /** The thread's `viewThread`; the files of an internal note are for staff. */
    private function messageAttachment(User $user, Message $message): ?Response
    {
        return $this->orderOf($message, static function (Order $order) use ($user, $message): Response {
            if ($message->kind === MessageKind::InternalNote && ! $user->isStaff()) {
                return Response::deny();
            }

            return Gate::forUser($user)->inspect('viewThread', [Message::class, $order]);
        });
    }

    /**
     * The record's order, a soft-deleted one included (its customer keeps access); no order at all is not served.
     *
     * @param  callable(Order): Response  $decide
     */
    private function orderOf(ProductionUpdate|OrderIssue|Delivery|Message $record, callable $decide): ?Response
    {
        $order = $record->order()->withTrashed()->first();

        return $order === null ? null : $decide($order);
    }
}
