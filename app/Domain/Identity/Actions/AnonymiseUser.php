<?php

declare(strict_types=1);

namespace App\Domain\Identity\Actions;

use App\Domain\Identity\Contracts\AccountDeletionStep;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Http\CodedValidationException;
use App\Support\Media\Media;
use App\Support\Privacy\Mask;
use Illuminate\Container\Attributes\Tag;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use libphonenumber\NumberParseException;
use libphonenumber\PhoneNumberUtil;
use LogicException;

/**
 * Removes the personal data of a customer for good (13 §9.2) and keeps what the business needs: orders, quotes, messages
 * and the rest of the accounting trail, which then point at an account named `Deleted customer {last 6 of id}`. One
 * transaction per user. Run by `users:anonymise-deleted` 30 days after the deletion request (`via: scheduler`), and by an
 * owner at once (`admin.customers.anonymise`), which refuses while an order is Active.
 *
 * `users` is judged column by column in `AnonymiseUserTest`: a column added later fails there until it is classified.
 */
final class AnonymiseUser
{
    public const string VIA_SCHEDULER = 'scheduler';

    public const string VIA_ADMIN = 'admin';

    private const string REMOVED = '[removed]';

    /** @param  iterable<AccountDeletionStep>  $steps */
    public function __construct(
        private readonly RevokeSessions $sessions,
        #[Tag('account.deletion_steps')] private readonly iterable $steps,
    ) {}

    /**
     * @param  string  $via  `scheduler` or `admin`
     * @param  User|null  $actor  the owner who does it, null for the scheduler
     *
     * @throws CodedValidationException `active_orders`, for an immediate anonymisation
     */
    public function handle(User $user, string $via, ?User $actor = null): void
    {
        if (! $user->isCustomer()) {
            throw new LogicException('Only customers are anonymised; staff are deactivated (13 §9.1).');
        }

        if ($user->anonymised_at !== null) {
            return;
        }

        if ($via !== self::VIA_SCHEDULER) {
            $this->refuseWhileOrdersAreActive($user);
        }

        // Redis first and outside the transaction: it cannot be rolled back, and rotating the remember token must not
        // come after the row is cleared.
        $this->sessions->all($user, RevokeSessions::REASON_ACCOUNT_DELETION);

        DB::transaction(function () use ($user, $via, $actor): void {
            $user->refresh();

            if (! $user->trashed()) {
                foreach ($this->steps as $step) {
                    $step->handle($user);
                }

                $user->delete();
            }

            $this->removeProjects($user);
            $this->scrubAddresses($user);
            $this->removePersonalRecords($user);
            $this->maskBusinessRecords($user);
            $this->scrubUser($user);

            $activity = activity('security')->performedOn($user);
            $actor === null ? $activity->causedByAnonymous() : $activity->causedBy($actor);
            $activity->event('account.anonymised')->withProperties(['via' => $via])->log('account.anonymised');
        });
    }

    private function refuseWhileOrdersAreActive(User $user): void
    {
        $numbers = $user->activeOrders()->pluck('number');

        if ($numbers->isNotEmpty()) {
            throw CodedValidationException::make('active_orders', trans_icu('account.errors.active_orders', ['numbers' => $numbers->implode(', ')]));
        }
    }

    /**
     * Projects nobody ordered from go with everything under them; the others keep their designs (business records of the
     * orders) and lose what describes the home: notes, plans, imports and the cover.
     */
    private function removeProjects(User $user): void
    {
        $ordered = Order::withTrashed()->where('customer_id', $user->getKey())->pluck('project_id')->all();

        foreach (Project::withTrashed()->where('owner_id', $user->getKey())->get() as $project) {
            $id = (string) $project->getKey();
            $plans = Plan::withTrashed()->where('project_id', $id);
            $imports = BlueprintImport::query()->where('project_id', $id);

            $this->deleteMedia('project', [$id]);
            $this->deleteMedia('plan', $this->idsOf((clone $plans)->pluck('id')));
            $this->deleteMedia('blueprint_import', $this->idsOf((clone $imports)->pluck('id')));

            if (in_array($id, $ordered, true)) {
                $plans->forceDelete();
                $imports->delete();
                $project->forceFill(['name' => 'Project '.substr($id, -6), 'notes' => null])->save();

                continue;
            }

            $designs = $this->idsOf(DB::table('furniture_designs')->where('project_id', $id)->pluck('id'));
            $this->deleteMedia('furniture_design', $designs);
            $this->deleteMedia('furniture_revision', $this->idsOf(DB::table('furniture_revisions')->whereIn('furniture_design_id', $designs)->pluck('id')));
            $project->forceDelete();
        }
    }

    /**
     * @param  Collection<array-key, mixed>  $ids
     * @return list<string>
     */
    private function idsOf(Collection $ids): array
    {
        return array_values($ids->map(static fn (mixed $id): string => (string) $id)->all());
    }

    /**
     * Files and rows of the media of the models, by morph alias and id; the database cascade would leave both behind.
     *
     * @param  list<string>  $ids
     */
    private function deleteMedia(string $morphAlias, array $ids): void
    {
        if ($ids === []) {
            return;
        }

        Media::query()->where('model_type', $morphAlias)->whereIn('model_id', $ids)->get()->each->delete();
    }

    /** An address an order points at stays for the tax and invoice jurisdiction, without the part that locates the home. */
    private function scrubAddresses(User $user): void
    {
        $used = Order::withTrashed()->whereNotNull('site_address_id')->select('site_address_id');

        Address::query()->where('user_id', $user->getKey())->whereNotIn('id', $used)->delete();
        Address::query()->where('user_id', $user->getKey())->update([
            'label' => self::REMOVED,
            'line1' => self::REMOVED,
            'line2' => null,
            'latitude' => null,
            'longitude' => null,
        ]);
    }

    private function removePersonalRecords(User $user): void
    {
        $id = $user->getKey();

        $user->notifications()->delete();
        NotificationPreference::query()->where('user_id', $id)->delete();
        $user->pushSubscriptions()->delete();
        NotificationDelivery::query()->where('user_id', $id)->update(['user_id' => null]);

        if ($user->phone_e164 !== null) {
            OtpCode::query()->where('phone_e164', $user->phone_e164)->delete();
        }

        if ($user->email !== null) {
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();
        }

        DB::table('sessions')->where('user_id', $id)->delete();

        // The bucket's copy of an upload nobody used goes with its row; a used one was deleted when it was consumed.
        $keys = UploadIntent::query()->where('user_id', $id)->where('status', '!=', UploadStatus::Consumed->value)
            ->get(['object_key', 'processed_key'])
            ->flatMap(static fn (UploadIntent $intent): array => [$intent->object_key, $intent->processed_key])
            ->filter()->values()->all();
        UploadIntent::query()->where('user_id', $id)->delete();
        DB::afterCommit(static fn () => Storage::disk('s3')->delete($keys));

        $user->clearMediaCollection('avatar');
    }

    /** The two records of the business that carry a contact detail of the customer are masked in place. */
    private function maskBusinessRecords(User $user): void
    {
        $orders = static fn (): Builder => Order::withTrashed()->where('customer_id', $user->getKey())->select('id');

        ConfirmationCall::query()->whereIn('order_id', $orders())->get()->each(
            fn (ConfirmationCall $call) => $call->forceFill(['phone_e164' => $this->zeroedPhone($call->phone_e164)])->saveQuietly(),
        );

        Quote::query()->whereIn('order_id', $orders())->whereNotNull('accepted_by_ip')->get()->each(
            static fn (Quote $quote) => $quote->forceFill(['accepted_by_ip' => Mask::ip((string) $quote->accepted_by_ip) ?: null])->saveQuietly(),
        );
    }

    /** `+919876543210` becomes `+910000000000`: the calling code stays, every other digit is a zero (13 §9.2). */
    private function zeroedPhone(string $e164): string
    {
        $digits = preg_replace('/\D/', '', $e164) ?? '';

        try {
            $code = (string) PhoneNumberUtil::getInstance()->parse($e164)->getCountryCode();
        } catch (NumberParseException) {
            $code = '';
        }

        return '+'.$code.str_repeat('0', max(0, strlen($digits) - strlen($code)));
    }

    private function scrubUser(User $user): void
    {
        $id = (string) $user->getKey();

        $user->forceFill([
            'name' => 'Deleted customer '.substr($id, -6),
            'email' => 'deleted+'.$id.'@invalid.invalid',
            'phone_e164' => null,
            'phone_verified_at' => null,
            'email_verified_at' => null,
            'first_contact_verified_at' => null,
            'password' => null,
            'google_id' => null,
            'remember_token' => null,
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'notes_internal' => null,
            'last_login_at' => null,
            'marketing_opt_in' => false,
            'anonymised_at' => now(),
        ])->save();
    }
}
