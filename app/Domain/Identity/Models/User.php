<?php

declare(strict_types=1);

namespace App\Domain\Identity\Models;

use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\OwnerGate;
use App\Domain\Identity\Enums\StaffRole;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Enums\UserType;
use App\Domain\Identity\Support\ContactVerification;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Models\UploadIntent;
use App\Notifications\Auth\ResetPassword;
use App\Notifications\Auth\VerifyEmail;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Identity\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Contracts\Translation\HasLocalePreference;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Gate;
use Laravel\Fortify\TwoFactorAuthenticatable;
use NotificationChannels\WebPush\HasPushSubscriptions;
use SensitiveParameter;
use Spatie\Image\Enums\Fit;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media as BaseMedia;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Traits\HasRoles;

/**
 * 02 §1.1. `type`, `is_active`, the verification and onboarding timestamps and the Fortify
 * columns are never mass-assigned; actions set them explicitly.
 *
 * @property string $id
 * @property UserType $type
 * @property string $name
 * @property string|null $email
 * @property CarbonImmutable|null $email_verified_at
 * @property string|null $phone_e164
 * @property CarbonImmutable|null $phone_verified_at
 * @property CarbonImmutable|null $first_contact_verified_at
 * @property string|null $password
 * @property string|null $google_id
 * @property UnitSystem $unit_system
 * @property LengthUnit $length_unit
 * @property string $locale
 * @property string $timezone
 * @property bool $is_active
 * @property CarbonImmutable|null $last_login_at
 * @property string|null $two_factor_secret
 * @property string|null $two_factor_recovery_codes
 * @property CarbonImmutable|null $two_factor_confirmed_at
 * @property string|null $remember_token
 * @property bool $marketing_opt_in
 * @property string|null $notes_internal
 * @property CarbonImmutable|null $terms_accepted_at
 * @property CarbonImmutable|null $onboarded_at
 * @property CarbonImmutable|null $anonymised_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['name', 'email', 'phone_e164', 'password', 'locale', 'timezone', 'unit_system', 'length_unit', 'marketing_opt_in'])]
#[Hidden(['password', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token'])]
final class User extends Authenticatable implements HasLocalePreference, HasMedia, MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, HasPushSubscriptions, HasRoles, HasUlids, InteractsWithMedia, Notifiable, SoftDeletes, TwoFactorAuthenticatable;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => UserType::class,
            'unit_system' => UnitSystem::class,
            'length_unit' => LengthUnit::class,
            'is_active' => 'bool',
            'marketing_opt_in' => 'bool',
            'email_verified_at' => 'immutable_datetime',
            'phone_verified_at' => 'immutable_datetime',
            'first_contact_verified_at' => 'immutable_datetime',
            'last_login_at' => 'immutable_datetime',
            'two_factor_confirmed_at' => 'immutable_datetime',
            'terms_accepted_at' => 'immutable_datetime',
            'onboarded_at' => 'immutable_datetime',
            'anonymised_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * Emails are stored trimmed and lower-cased (the unique index is case-sensitive);
     * an empty value means "no email" (phone-only accounts).
     *
     * @return Attribute<string|null, string|null>
     */
    protected function email(): Attribute
    {
        return Attribute::set(static function (?string $value): ?string {
            $normalised = mb_strtolower(trim((string) $value));

            return $normalised === '' ? null : $normalised;
        });
    }

    /**
     * @return HasMany<Address, $this>
     */
    public function addresses(): HasMany
    {
        return $this->hasMany(Address::class);
    }

    /**
     * @return HasMany<NotificationDelivery, $this>
     */
    public function notificationDeliveries(): HasMany
    {
        return $this->hasMany(NotificationDelivery::class);
    }

    /**
     * @return HasMany<UploadIntent, $this>
     */
    public function uploadIntents(): HasMany
    {
        return $this->hasMany(UploadIntent::class);
    }

    /**
     * Projects this user owns as the customer (`projects.owner_id`).
     *
     * @return HasMany<Project, $this>
     */
    public function projects(): HasMany
    {
        return $this->hasMany(Project::class, 'owner_id');
    }

    /**
     * Orders this user placed as the customer (`orders.customer_id`).
     *
     * @return HasMany<Order, $this>
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'customer_id');
    }

    /**
     * The user's AI credit ledger (02 §7.1); the balance is the sum of its deltas.
     *
     * @return HasMany<AiCreditLedgerEntry, $this>
     */
    public function aiCreditLedgerEntries(): HasMany
    {
        return $this->hasMany(AiCreditLedgerEntry::class);
    }

    /** 02 §10: one avatar (jpg, png, webp) on the public disk with a 128 px `thumb`. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('avatar')
            ->useDisk('s3-public')
            ->singleFile()
            ->acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp']);
    }

    public function registerMediaConversions(?BaseMedia $media = null): void
    {
        $this->addMediaConversion('thumb')
            ->performOnCollections('avatar')
            ->fit(Fit::Crop, 128, 128);
    }

    public function isStaff(): bool
    {
        return $this->type === UserType::Staff;
    }

    public function isCustomer(): bool
    {
        return $this->type === UserType::Customer;
    }

    /** Email or phone verified: the gate of `verified.contact` (13 §2); phone-only users have no email. */
    public function hasVerifiedContact(): bool
    {
        return $this->email_verified_at !== null || $this->phone_verified_at !== null;
    }

    /** Owners and admins must have a confirmed TOTP to use the admin area (13 S4, §5.10); read from the roles each time. */
    public function requiresTwoFactor(): bool
    {
        return $this->isStaff() && $this->hasAnyRole(array_map(
            static fn (StaffRole $role): string => $role->value,
            array_filter(StaffRole::cases(), static fn (StaffRole $role): bool => $role->requiresTwoFactor()),
        ));
    }

    public function hasPassword(): bool
    {
        return $this->password !== null;
    }

    /**
     * Whether the user has a way to prove who they are again: a password, a verified phone or a linked Google account
     * (13 §6.4). Changing the phone number of such a user needs a recent authentication (`recent.auth`), or a stolen
     * session could swap in its own number and confirm itself with a code sent there.
     */
    public function hasSignInCredential(): bool
    {
        return $this->hasPassword()
            || ($this->phone_e164 !== null && $this->phone_verified_at !== null)
            || $this->google_id !== null;
    }

    /** The mail with the link to choose a new password (13 §2); the broker passes the token. */
    public function sendPasswordResetNotification(#[SensitiveParameter] $token): void
    {
        $this->notify(new ResetPassword((string) $token));
    }

    /** The mail with the link that verifies the address; there is nothing to verify, and nobody to mail, without one. */
    public function sendEmailVerificationNotification(): void
    {
        if ($this->email === null) {
            return;
        }

        $this->notify(new VerifyEmail);
    }

    /** Verifies the email through `ContactVerification`, which also tells the app when it is the first verified contact. */
    public function markEmailAsVerified(): bool
    {
        if ($this->email === null) {
            return false;
        }

        app(ContactVerification::class)->markEmailVerified($this);

        return true;
    }

    /**
     * Names of every permission the user holds through roles, for the `auth.user.permissions` shared prop (13 §7.4).
     *
     * @return list<string>
     */
    public function permissionNames(): array
    {
        $names = $this->getAllPermissions()->map(static fn (Permission $permission): string => $permission->name)->all();
        sort($names);

        return $names;
    }

    /**
     * The owner-only gates (13 §7.3) the user passes, for the `auth.user.abilities` shared prop (13 §7.4).
     *
     * @return list<string>
     */
    public function abilities(): array
    {
        $gate = Gate::forUser($this);

        return array_values(array_map(
            static fn (OwnerGate $ability): string => $ability->value,
            array_filter(OwnerGate::cases(), static fn (OwnerGate $ability): bool => $gate->allows($ability->value)),
        ));
    }

    /** Notifications render in the recipient's locale (12 §4.4). */
    public function preferredLocale(): string
    {
        return $this->locale;
    }

    /** Private broadcast channel of this user (01 §8). */
    public function receivesBroadcastNotificationsOn(): string
    {
        return 'users.'.$this->id;
    }

    protected static function newFactory(): UserFactory
    {
        return UserFactory::new();
    }
}
