<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Enums\MessageKind;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Enums\ProductionVisibility;
use App\Domain\Orders\Enums\QuoteStatus;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\PlanRevision;
use App\Domain\Projects\Models\Project;
use App\Support\Media\Media;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The customer's data as one JSON file (13 §9.3, version 1). Written as it is read: every list is a lazy cursor over
 * the table (`lazyById`), so memory stays bounded however much the customer has. Each section names the columns it
 * exports, so a column added later stays out of the file until someone decides it belongs in it; what staff alone
 * may see (internal notes, costs, staff drafts, draft quotes and proposals, internal updates) is never listed.
 * Photos and plan files are not embedded: `media` lists them.
 */
final class ExportUserData
{
    public const int VERSION = 1;

    /** Columns of `users` that are not exported (13 §9.3). */
    private const array PROFILE_EXCLUDED = ['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes', 'notes_internal'];

    private const int CHUNK = 100;

    public function stream(User $user): StreamedResponse
    {
        activity('security')
            ->performedOn($user)
            ->causedBy($user)
            ->event('account.data_exported')
            ->withProperties(['via' => 'web'])
            ->log('account.data_exported');

        $filename = Str::slug((string) config('app.name')).'-export-'.now()->format('Y-m-d').'.json';

        return response()->streamDownload(function () use ($user): void {
            $this->write($user);
        }, $filename, ['Content-Type' => 'application/json']);
    }

    private function write(User $user): void
    {
        $id = (string) $user->getKey();

        echo '{"version":'.self::VERSION.',"exportedAt":'.$this->json(now()->toIso8601String());
        echo ',"profile":'.$this->json($this->profile($user));

        $this->section('addresses', $user->addresses()->lazyById(self::CHUNK), fn (Model $address): array => $this->row($address, [
            'id', 'label', 'line1', 'line2', 'city', 'region', 'postal_code', 'country_code', 'latitude', 'longitude', 'created_at',
        ]));

        $this->section('notificationPreferences', NotificationPreference::query()->where('user_id', $id)->lazyById(self::CHUNK), fn (Model $preference): array => $this->row($preference, [
            'event_key', 'channel', 'enabled',
        ]));

        $this->section('projects', $user->projects()->lazyById(self::CHUNK), null, fn (Project $project) => $this->project($project));
        $this->section('orders', $user->orders()->lazyById(self::CHUNK), null, fn (Order $order) => $this->order($order));

        $this->section('aiCreditLedger', AiCreditLedgerEntry::query()->where('user_id', $id)->lazyById(self::CHUNK), fn (Model $entry): array => $this->row($entry, [
            'id', 'delta', 'kind', 'period', 'note', 'created_at',
        ]));

        $this->section('media', $this->mediaOf($user)->lazyById(self::CHUNK), static fn (Media $media): array => [
            'collection' => $media->collection_name,
            'fileName' => $media->file_name,
            'size' => (int) $media->size,
            'createdAt' => $media->created_at?->toIso8601String(),
        ]);

        echo '}';
    }

    /** @return array<string, mixed> */
    private function profile(User $user): array
    {
        $attributes = $user->attributesToArray();
        $row = [];

        foreach ($attributes as $column => $value) {
            if (! in_array($column, self::PROFILE_EXCLUDED, true)) {
                $row[Str::camel($column)] = $value;
            }
        }

        return $row;
    }

    private function project(Project $project): void
    {
        $this->object(
            $this->row($project, ['id', 'name', 'property_type', 'status', 'notes', 'site_address_id', 'created_at', 'updated_at']),
            [
                'plans' => fn () => $this->list($project->plans()->lazyById(self::CHUNK), null, fn (Plan $plan) => $this->object(
                    $this->row($plan, ['id', 'name', 'level_index', 'source', 'working_document', 'working_version', 'schema_version', 'summary', 'created_at', 'updated_at']),
                    ['revisions' => fn () => $this->list(
                        PlanRevision::query()->where('plan_id', $plan->getKey())->select(['id', 'number', 'schema_version', 'reason', 'label', 'created_at'])->lazyById(self::CHUNK),
                        fn (Model $revision): array => $this->row($revision, ['id', 'number', 'schema_version', 'reason', 'label', 'created_at']),
                    )],
                )),
                'furnitureDesigns' => fn () => $this->list(
                    FurnitureDesign::query()->where('project_id', $project->getKey())->lazyById(self::CHUNK),
                    fn (Model $design): array => $this->row($design, ['id', 'name', 'template_key', 'working_document', 'working_version', 'width_mm', 'height_mm', 'depth_mm', 'created_at', 'updated_at']),
                ),
                'imports' => fn () => $this->list(
                    BlueprintImport::query()->where('project_id', $project->getKey())->lazyById(self::CHUNK),
                    fn (Model $import): array => $this->row($import, ['id', 'status', 'mode', 'source_kind', 'original_filename', 'mime_type', 'file_size_bytes', 'page_count', 'credits_charged', 'created_at', 'finished_at']),
                ),
            ],
        );
    }

    private function order(Order $order): void
    {
        $row = $this->row($order, [
            'id', 'number', 'project_id', 'title', 'customer_notes', 'site_address_id', 'needs_installation', 'preferred_delivery_on',
            'expected_delivery_on', 'production_progress', 'production_stage', 'cancel_reason', 'cancel_note', 'submitted_at',
            'quoted_at', 'accepted_at', 'confirmed_at', 'completed_at', 'delivered_at', 'closed_at', 'cancelled_at', 'created_at',
        ]);
        $row['state'] = (string) $order->getRawOriginal('state');

        $this->object($row, [
            'items' => fn () => $this->list($order->items()->lazyById(self::CHUNK), fn (Model $item): array => $this->row($item, [
                'id', 'furniture_design_id', 'furniture_revision_id', 'quantity', 'room_label', 'customer_notes', 'sort_order',
            ])),
            'quotes' => fn () => $this->list(
                $order->quotes()->where('status', '!=', QuoteStatus::Draft->value)->lazyById(self::CHUNK),
                null,
                fn (Quote $quote) => $this->object(
                    $this->row($quote, [
                        'id', 'version', 'number', 'status', 'currency', 'prices_include_tax', 'subtotal_minor', 'discount_minor', 'tax_minor',
                        'total_minor', 'tax_breakdown', 'valid_until', 'lead_time_days', 'notes_to_customer', 'terms', 'sent_at', 'accepted_at',
                        'declined_at', 'expired_at', 'superseded_at', 'withdrawn_at', 'decline_reason', 'accepted_by_ip', 'created_at',
                    ]),
                    ['lines' => fn () => $this->list(
                        $quote->lines()->where('is_visible_to_customer', true)->lazyById(self::CHUNK),
                        fn (Model $line): array => $this->row($line, ['id', 'kind', 'description', 'details', 'quantity', 'unit', 'unit_price_minor', 'amount_minor', 'sort_order']),
                    )],
                ),
            ),
            'changeProposals' => fn () => $this->list(
                $order->changeProposals()->whereNotNull('sent_at')->lazyById(self::CHUNK),
                null,
                fn (ChangeProposal $proposal) => $this->object(
                    $this->row($proposal, ['id', 'number', 'status', 'message', 'sent_at', 'resolved_at', 'withdrawn_at', 'customer_comment']),
                    ['items' => fn () => $this->list(
                        $proposal->items()->lazyById(self::CHUNK),
                        fn (Model $item): array => $this->row($item, ['id', 'order_item_id', 'from_revision_id', 'to_revision_id', 'changes', 'staff_note', 'decision', 'customer_comment', 'decided_at']),
                    )],
                ),
            ),
            'negotiations' => fn () => $this->list($order->negotiations()->lazyById(self::CHUNK), fn (Model $negotiation): array => $this->row($negotiation, [
                'id', 'quote_id', 'proposed_total_minor', 'message', 'item_comments', 'status', 'answer_message', 'answered_at', 'created_at',
            ])),
            'messages' => fn () => $this->list(
                $order->messages()->where('kind', '!=', MessageKind::InternalNote->value)->lazyById(self::CHUNK),
                fn (Model $message): array => $this->row($message, ['id', 'author_id', 'kind', 'body', 'system_event', 'system_payload', 'edited_at', 'created_at']),
            ),
            'productionUpdates' => fn () => $this->list(
                $order->productionUpdates()->where('visibility', ProductionVisibility::Customer->value)->lazyById(self::CHUNK),
                fn (Model $update): array => $this->row($update, ['id', 'stage', 'progress', 'title', 'body', 'is_completion', 'created_at']),
            ),
            'issues' => fn () => $this->list($order->issues()->lazyById(self::CHUNK), fn (Model $issue): array => $this->row($issue, [
                'id', 'order_item_id', 'description', 'status', 'resolution_note', 'resolved_at', 'created_at',
            ])),
            'delivery' => function () use ($order): void {
                echo $this->json($order->delivery === null ? null : $this->row($order->delivery, [
                    'scheduled_for', 'scheduled_until', 'delivered_at', 'installed', 'recipient_name', 'notes',
                ]));
            },
        ]);
    }

    /**
     * The files the customer owns or uploaded: the avatar, their projects, plans, designs and imports, their messages.
     *
     * @return Builder<Media>
     */
    private function mediaOf(User $user): Builder
    {
        $id = (string) $user->getKey();
        $projects = Project::query()->where('owner_id', $id)->select('id');

        return Media::query()->where(function (Builder $query) use ($id, $projects): void {
            $query->where(fn (Builder $q) => $q->where('model_type', 'user')->where('model_id', $id))
                ->orWhere(fn (Builder $q) => $q->where('model_type', 'project')->whereIn('model_id', $projects))
                ->orWhere(fn (Builder $q) => $q->where('model_type', 'plan')->whereIn('model_id', Plan::query()->whereIn('project_id', $projects)->select('id')))
                ->orWhere(fn (Builder $q) => $q->where('model_type', 'furniture_design')->whereIn('model_id', FurnitureDesign::query()->where('owner_id', $id)->select('id')))
                ->orWhere(fn (Builder $q) => $q->where('model_type', 'blueprint_import')->whereIn('model_id', BlueprintImport::query()->where('user_id', $id)->select('id')))
                ->orWhere(fn (Builder $q) => $q->where('model_type', 'message')->whereIn('model_id', Message::query()->where('author_id', $id)->select('id')));
        });
    }

    /**
     * `,"key":[ ... ]` for the top-level object.
     *
     * @template T of Model
     *
     * @param  iterable<T>  $rows
     * @param  (Closure(T): array<string, mixed>)|null  $toRow  a flat row, or
     * @param  (Closure(T): mixed)|null  $write  a closure that writes the whole item itself
     */
    private function section(string $key, iterable $rows, ?Closure $toRow, ?Closure $write = null): void
    {
        echo ','.$this->json($key).':';
        $this->list($rows, $toRow, $write);
    }

    /**
     * @template T of Model
     *
     * @param  iterable<T>  $rows
     * @param  (Closure(T): array<string, mixed>)|null  $toRow
     * @param  (Closure(T): mixed)|null  $write
     */
    private function list(iterable $rows, ?Closure $toRow, ?Closure $write = null): void
    {
        echo '[';
        $first = true;

        foreach ($rows as $row) {
            echo $first ? '' : ',';
            $first = false;

            if ($write !== null) {
                $write($row);
            } elseif ($toRow !== null) {
                echo $this->json($toRow($row));
            }
        }

        echo ']';
    }

    /**
     * A JSON object made of a flat row and lists written as they are read.
     *
     * @param  array<string, mixed>  $row
     * @param  array<string, Closure(): mixed>  $nested
     */
    private function object(array $row, array $nested): void
    {
        echo substr($this->json($row), 0, -1);

        foreach ($nested as $key => $write) {
            echo ','.$this->json($key).':';
            $write();
        }

        echo '}';
    }

    /**
     * @param  list<string>  $columns
     * @return array<string, mixed>
     */
    private function row(Model $model, array $columns): array
    {
        $attributes = $model->attributesToArray();
        $row = [];

        foreach ($columns as $column) {
            if (array_key_exists($column, $attributes)) {
                $row[Str::camel($column)] = $attributes[$column];
            }
        }

        return $row;
    }

    private function json(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    }
}
