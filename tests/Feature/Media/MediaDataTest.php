<?php

declare(strict_types=1);

use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Shared\Data\MediaData;

it('describes an image with stable policy-checked URLs', function (): void {
    $media = ProductionUpdate::factory()->create()
        ->addMediaFromString((string) file_get_contents(base_path('tests/fixtures/uploads/plain.png')))
        ->usingName('Left door')->usingFileName('door.png')
        ->withCustomProperties(['width' => 640, 'height' => 480])
        ->toMediaCollection('photos');

    $url = route('media.show', $media->uuid);

    expect(MediaData::fromMedia($media)->toArray())->toBe([
        'id' => $media->uuid,
        'name' => 'Left door',
        'mimeType' => 'image/png',
        'size' => $media->size,
        'url' => $url,
        'thumbUrl' => $url.'?conversion=thumb',
        'largeUrl' => $url.'?conversion=large',
        'width' => 640,
        'height' => 480,
    ]);
});

it('gives a PDF no thumbnails and no dimensions', function (): void {
    $media = Message::factory()->create()
        ->addMediaFromString("%PDF-1.4\n%%EOF")->usingFileName('plan.pdf')->toMediaCollection('attachments');

    $data = MediaData::fromMedia($media);

    expect([$data->thumbUrl, $data->largeUrl, $data->width, $data->height])->toBe([null, null, null, null]);
});
