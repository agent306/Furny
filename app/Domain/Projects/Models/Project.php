<?php

declare(strict_types=1);

namespace App\Domain\Projects\Models;

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Enums\ProjectStatus;
use App\Domain\Projects\Enums\PropertyType;
use Carbon\CarbonImmutable;
use Database\Factories\Domain\Projects\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;

/**
 * 02 §3.1. `owner_id` is the customer (set through `User::projects()` or explicitly by the action,
 * never mass-assigned); staff creating a project on a customer's behalf appear in `created_by`.
 *
 * @property string $id
 * @property string $owner_id
 * @property string|null $created_by
 * @property string $name
 * @property PropertyType $property_type
 * @property string|null $site_address_id
 * @property string|null $notes
 * @property ProjectStatus $status
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 */
#[Fillable(['name', 'property_type', 'site_address_id', 'notes', 'status', 'created_by'])]
final class Project extends Model implements HasMedia
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'property_type' => PropertyType::class,
            'status' => ProjectStatus::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<Address, $this>
     */
    public function siteAddress(): BelongsTo
    {
        return $this->belongsTo(Address::class, 'site_address_id');
    }

    /**
     * @return HasMany<Plan, $this>
     */
    public function plans(): HasMany
    {
        return $this->hasMany(Plan::class);
    }

    /**
     * @return HasMany<FurnitureDesign, $this>
     */
    public function furnitureDesigns(): HasMany
    {
        return $this->hasMany(FurnitureDesign::class);
    }

    /**
     * @return HasMany<BlueprintImport, $this>
     */
    public function blueprintImports(): HasMany
    {
        return $this->hasMany(BlueprintImport::class);
    }

    /**
     * @return HasMany<Order, $this>
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    /** 02 §10: one auto-generated 3D cover (png, webp) on the public disk. */
    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('cover')
            ->useDisk('s3-public')
            ->singleFile()
            ->acceptsMimeTypes(['image/png', 'image/webp']);
    }

    protected static function newFactory(): ProjectFactory
    {
        return ProjectFactory::new();
    }
}
