<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureRevision;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\Delivery;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\OrderIssue;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\States\Submitted;
use App\Domain\Projects\Models\Plan;
use App\Support\Media\Media;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;

beforeEach(function (): void {
    // The faked disk cannot sign: this stand-in puts the path and the signed options in the URL.
    Storage::disk('s3')->buildTemporaryUrlsUsing(
        fn (string $path, mixed $expiration, array $options): string => 'https://storage.test/'.$path.'?'.http_build_query($options + ['exp' => $expiration->getTimestamp()]),
    );
    $this->travelTo(now()->startOfSecond());
});

function attach(Model $owner, string $collection, string $file = 'photo.png'): Media
{
    $bytes = str_ends_with($file, '.pdf') ? "%PDF-1.4\n%%EOF" : (string) file_get_contents(base_path('tests/fixtures/uploads/plain.png'));
    $media = $owner->addMediaFromString($bytes)->usingName(pathinfo($file, PATHINFO_FILENAME))->usingFileName($file)->toMediaCollection($collection);
    assert($media instanceof Media);

    return $media;
}

function openMedia(Media $media, ?User $as, string $query = ''): TestResponse
{
    $test = $as === null ? test() : test()->actingAs($as);

    return $test->get(route('media.show', $media->uuid).$query);
}

/** @return array<string, mixed> the options the stand-in signer was asked for, read back from the redirect */
function signedOptions(TestResponse $response): array
{
    parse_str((string) parse_url((string) $response->headers->get('Location'), PHP_URL_QUERY), $options);

    return $options;
}

it('sends the owner of a plan to a 15-minute URL of the file, never cached', function (): void {
    $plan = Plan::factory()->withThumbnail()->create();
    $media = $plan->getFirstMedia('thumbnail');

    $response = openMedia($media, $plan->project->owner)->assertRedirect();

    expect($response->headers->get('Location'))->toContain($media->getPathRelativeToRoot())
        ->and($response->headers->get('Cache-Control'))->toContain('private')->toContain('no-store')
        ->and(signedOptions($response)['exp'])->toBe((string) now()->addMinutes(15)->getTimestamp());
});

it('serves an image inline: no forced download', function (): void {
    $plan = Plan::factory()->withThumbnail()->create();

    $options = signedOptions(openMedia($plan->getFirstMedia('thumbnail'), $plan->project->owner));

    expect($options)->not->toHaveKey('ResponseContentDisposition');
});

it('hides the plan from another customer and shows it to staff who see customers', function (): void {
    $plan = Plan::factory()->withThumbnail()->create();
    $media = $plan->getFirstMedia('thumbnail');

    openMedia($media, User::factory()->create())->assertNotFound();
    openMedia($media, User::factory()->admin()->create())->assertRedirect();
});

it('sends a guest to log in', function (): void {
    $plan = Plan::factory()->withThumbnail()->create();

    openMedia($plan->getFirstMedia('thumbnail'), null)->assertRedirectToRoute('login');
});

it('keeps an internal production photo from the customer and shows a customer one', function (): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $internal = attach(ProductionUpdate::factory()->internal()->for($order)->create(), 'photos');
    $shared = attach(ProductionUpdate::factory()->for($order)->create(), 'photos');
    $production = User::factory()->production()->create();

    openMedia($internal, $order->customer)->assertNotFound();
    openMedia($internal, $production)->assertRedirect();
    openMedia($shared, $order->customer)->assertRedirect();
    openMedia($shared, User::factory()->create())->assertNotFound();
});

it('serves the photos of an issue and of a delivery to the customer of the order and to staff only', function (string $class): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $media = attach($class::factory()->for($order)->create(), 'photos');

    openMedia($media, $order->customer)->assertRedirect();
    openMedia($media, User::factory()->support()->create())->assertRedirect();
    openMedia($media, User::factory()->create())->assertNotFound();
})->with([OrderIssue::class, Delivery::class]);

it('hands a quote PDF over as an attachment with its type', function (): void {
    $quote = Quote::factory()->sent()->create();
    $media = attach($quote, 'pdf', 'quote.pdf');

    $response = openMedia($media, $quote->order->customer)->assertRedirect();

    expect(signedOptions($response))->toMatchArray([
        'ResponseContentDisposition' => 'attachment; filename="quote.pdf"',
        'ResponseContentType' => 'application/pdf',
    ]);
});

it('does not show a draft quote PDF to its customer', function (): void {
    $quote = Quote::factory()->create();

    openMedia(attach($quote, 'pdf', 'quote.pdf'), $quote->order->customer)->assertNotFound();
});

it('gives the cut list to staff who see orders and not to the customer', function (): void {
    $revision = FurnitureRevision::factory()->create();
    $media = attach($revision, 'cutlist_pdf', 'cutlist.pdf');

    openMedia($media, User::factory()->support()->create())->assertRedirect();
    openMedia($media, $revision->furnitureDesign->project->owner)->assertNotFound();
});

it('keeps the import debug files from the customer', function (): void {
    $import = BlueprintImport::factory()->create();
    $media = attach($import, 'debug');

    openMedia($media, User::factory()->estimator()->create())->assertRedirect();
    $roleless = User::factory()->production()->create();
    $roleless->syncRoles([]);
    openMedia($media, $roleless)->assertForbidden();
    openMedia($media, $import->project->owner)->assertNotFound();
});

it('keeps the attachment of an internal note from the customer', function (): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $note = attach(Message::factory()->internalNote()->for($order)->create(), 'attachments');
    $text = attach(Message::factory()->for($order)->create(), 'attachments');

    openMedia($note, $order->customer)->assertNotFound();
    openMedia($note, User::factory()->support()->create())->assertRedirect();
    openMedia($text, $order->customer)->assertRedirect();
});

it('does not serve a public-disk collection', function (): void {
    $user = User::factory()->create();

    openMedia(attach($user, 'avatar'), $user)->assertNotFound();
});

it('answers 404 for something that is not a media id', function (): void {
    $this->actingAs(User::factory()->create())->get('/media/not-a-uuid')->assertNotFound();
});

it('hands a DXF over as an attachment although its type starts with image/', function (): void {
    $import = BlueprintImport::factory()->create();
    $media = attach($import, 'source', 'plan.dxf');
    $media->forceFill(['mime_type' => 'image/vnd.dxf'])->save();

    $response = openMedia($media, $import->project->owner)->assertRedirect();

    expect(signedOptions($response))->toMatchArray([
        'ResponseContentDisposition' => 'attachment; filename="plan.dxf"',
        'ResponseContentType' => 'image/vnd.dxf',
    ]);
});

it('serves only JPEG, PNG and WebP inline', function (string $mime, bool $inline): void {
    $plan = Plan::factory()->withThumbnail()->create();
    $media = $plan->getFirstMedia('thumbnail');
    $media->forceFill(['mime_type' => $mime])->save();

    $options = signedOptions(openMedia($media, $plan->project->owner));

    expect(array_key_exists('ResponseContentDisposition', $options))->toBe(! $inline);
})->with([['image/jpeg', true], ['image/png', true], ['image/webp', true], ['image/heic', false], ['image/svg+xml', false], ['application/pdf', false]]);

it('refuses a conversion that is not one of the known names', function (string $conversion): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $media = attach(ProductionUpdate::factory()->for($order)->create(), 'photos');

    openMedia($media, $order->customer, '?conversion='.$conversion)->assertUnprocessable();
})->with(['nope', '../thumb', 'THUMB']);

it('serves a conversion that exists and the file itself otherwise', function (): void {
    $order = Order::factory()->inState(Submitted::class)->create();
    $media = attach(ProductionUpdate::factory()->for($order)->create(), 'photos');
    $media->markAsConversionGenerated('thumb');

    expect(openMedia($media, $order->customer, '?conversion=thumb')->headers->get('Location'))->toContain('conversions/')
        ->and(openMedia($media, $order->customer, '?conversion=large')->headers->get('Location'))->not->toContain('conversions/')
        ->and(openMedia($media, $order->customer, '?conversion=small')->headers->get('Location'))->not->toContain('conversions/');
});
