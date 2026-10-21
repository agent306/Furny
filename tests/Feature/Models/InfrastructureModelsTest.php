<?php

declare(strict_types=1);

use App\Domain\Identity\Enums\DeliveryDriver;
use App\Domain\Identity\Enums\DeliveryStatus;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\User;
use App\Domain\Shared\Enums\NotificationChannel;
use App\Support\Media\Media;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use NotificationChannels\WebPush\PushSubscription;
use Spatie\MediaLibrary\Conversions\Conversion;
use Spatie\MediaLibrary\Conversions\ConversionCollection;
use Spatie\MediaLibrary\MediaCollections\Exceptions\FileUnacceptableForCollection;

it('has the DeliveryDriver and DeliveryStatus cases of 02 §1.7', function (): void {
    expect(array_map(static fn (DeliveryDriver $d): string => $d->value, DeliveryDriver::cases()))->toBe(['meta', 'twilio', 'msg91', 'log', 'array'])
        ->and(array_map(static fn (DeliveryStatus $s): string => $s->value, DeliveryStatus::cases()))->toBe(['pending', 'accepted', 'sent', 'delivered', 'read', 'failed']);
});

it('casts a notification delivery', function (): void {
    $delivery = NotificationDelivery::factory()->create(['context' => ['event' => 'order.quoted'], 'billable' => true])->refresh();

    expect($delivery->id)->toHaveLength(26)
        ->and($delivery->channel)->toBe(NotificationChannel::Whatsapp)
        ->and($delivery->driver)->toBeInstanceOf(DeliveryDriver::class)
        ->and($delivery->status)->toBe(DeliveryStatus::Pending)
        ->and($delivery->context)->toBe(['event' => 'order.quoted'])
        ->and($delivery->billable)->toBeTrue()
        ->and($delivery->attempts)->toBe(0)
        ->and($delivery->user)->toBeInstanceOf(User::class)
        ->and($delivery->to_hash)->toHaveLength(64);
});

it('links an SMS fallback to the failed WhatsApp delivery and nulls it on delete', function (): void {
    $failed = NotificationDelivery::factory()->failed()->create();
    $fallback = NotificationDelivery::factory()->sms()->fallbackOf($failed)->create();

    expect($fallback->fallbackOf->is($failed))->toBeTrue()
        ->and($failed->fallbacks->first()->is($fallback))->toBeTrue();

    $failed->delete();

    expect($fallback->refresh()->fallback_of_id)->toBeNull();
});

it('keeps a delivery with a null user when the user is removed', function (): void {
    $user = User::factory()->create();
    $delivery = NotificationDelivery::factory()->for($user)->create();

    $user->forceDelete();

    expect($delivery->refresh()->user_id)->toBeNull();
});

it('rejects a duplicate provider message id per driver but allows several nulls', function (): void {
    NotificationDelivery::factory()->create(['driver' => DeliveryDriver::Meta, 'provider_message_id' => 'wamid.1']);
    NotificationDelivery::factory()->count(2)->create(['driver' => DeliveryDriver::Meta, 'provider_message_id' => null]);
    NotificationDelivery::factory()->create(['driver' => DeliveryDriver::Twilio, 'provider_message_id' => 'wamid.1']);

    expect(NotificationDelivery::query()->count())->toBe(4);

    NotificationDelivery::factory()->create(['driver' => DeliveryDriver::Meta, 'provider_message_id' => 'wamid.1']);
})->throws(QueryException::class);

it('exposes delivery relations on the user', function (): void {
    $user = User::factory()->create();
    NotificationDelivery::factory()->for($user)->create();

    expect($user->notificationDeliveries)->toHaveCount(1);
});

it('registers the avatar collection and thumb conversion on the user', function (): void {
    Storage::fake('s3-public');

    $user = User::factory()->create();
    $media = $user->addMedia(UploadedFile::fake()->image('me.png', 400, 400))->toMediaCollection('avatar');

    expect($media)->toBeInstanceOf(Media::class)
        ->and($media->disk)->toBe('s3-public')
        ->and($media->model_id)->toBe($user->id)
        ->and($media->model_type)->toBe('user')
        ->and(ConversionCollection::createForMedia($media)->map(fn (Conversion $c): string => $c->getName())->all())->toBe(['thumb'])
        ->and($user->getMedia('avatar'))->toHaveCount(1);

    $second = $user->addMedia(UploadedFile::fake()->image('again.png', 400, 400))->toMediaCollection('avatar');

    expect($user->refresh()->getMedia('avatar'))->toHaveCount(1)
        ->and($user->getFirstMedia('avatar')->is($second))->toBeTrue()
        ->and($user->getMediaCollection('avatar')->acceptsMimeTypes)->toBe(['image/jpeg', 'image/png', 'image/webp']);
});

it('rejects a non-image avatar', function (): void {
    Storage::fake('s3-public');

    User::factory()->create()->addMedia(UploadedFile::fake()->create('evil.pdf', 10, 'application/pdf'))->toMediaCollection('avatar');
})->throws(FileUnacceptableForCollection::class);

it('trims the char(26) padding of the media model id', function (): void {
    $media = new Media;
    $media->setRawAttributes(['model_id' => '01J9ZZZZZZZZZZZZZZZZZZZZZZ  ']);

    expect($media->model_id)->toBe('01J9ZZZZZZZZZZZZZZZZZZZZZZ');
});

it('stores push subscriptions against the user under the morph alias', function (): void {
    $user = User::factory()->create();
    $user->updatePushSubscription('https://push.example/endpoint-1', 'key', 'token', 'aesgcm');

    $subscription = PushSubscription::query()->firstOrFail();

    expect($subscription->subscribable_type)->toBe('user')
        ->and($subscription->subscribable_id)->toBe($user->id)
        ->and($user->pushSubscriptions)->toHaveCount(1);
});
