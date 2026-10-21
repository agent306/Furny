<?php

declare(strict_types=1);

use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\User;
use App\Domain\Orders\Models\Order;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Uploads\UploadPresigner;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Testing\TestResponse;
use Tests\Support\Uploads\FakeUploadPresigner;

const PRESIGN_MB = 1024 * 1024;

/**
 * @param  array<string, mixed>  $body
 */
function presign(User $user, array $body): TestResponse
{
    return test()->actingAs($user)->postJson(route('api.uploads.presign'), $body);
}

/** @return array<string, mixed> */
function presignBody(UploadPurpose $purpose = UploadPurpose::Avatar, string $filename = 'me.png', string $contentType = 'image/png', int $size = PRESIGN_MB, ?Model $target = null): array
{
    return [
        'purpose' => $purpose->value,
        'filename' => $filename,
        'size' => $size,
        'contentType' => $contentType,
        'target' => $target === null ? null : ['type' => $target->getMorphClass(), 'id' => $target->getKey()],
    ];
}

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2030-06-15 12:00:00', 'UTC'));
});

it('presigns an avatar upload and records a pending intent', function (): void {
    $user = User::factory()->create();

    $response = presign($user, presignBody(filename: 'My Face.PNG'));
    $intent = UploadIntent::query()->sole();

    $response->assertCreated()
        ->assertExactJson([
            'uploadId' => $intent->id,
            'url' => FakeUploadPresigner::HOST.'/'.$intent->object_key.'?op=put&expires='.CarbonImmutable::parse('2030-06-15 12:15:00', 'UTC')->getTimestamp(),
            'headers' => ['Content-Type' => 'image/png', 'Content-Length' => '1048576'],
            'expiresAt' => '2030-06-15T12:15:00+00:00',
        ]);

    expect($intent->user_id)->toBe($user->id)
        ->and($intent->purpose)->toBe(UploadPurpose::Avatar)
        ->and($intent->status)->toBe(UploadStatus::Pending)
        ->and($intent->object_key)->toBe('tmp/avatar/2030/06/'.$intent->id)
        ->and($intent->id)->toHaveLength(26)
        ->and($intent->original_filename)->toBe('My Face.png')
        ->and($intent->declared_mime)->toBe('image/png')
        ->and($intent->declared_size)->toBe(PRESIGN_MB)
        ->and($intent->target_type)->toBeNull()->and($intent->target_id)->toBeNull()
        ->and($intent->expires_at->equalTo(CarbonImmutable::parse('2030-06-15 12:15:00', 'UTC')))->toBeTrue();

    $put = app(UploadPresigner::class)->puts;
    expect($put)->toHaveCount(1)
        ->and($put[0]['key'])->toBe($intent->object_key)
        ->and($put[0]['contentType'])->toBe('image/png')
        ->and($put[0]['size'])->toBe(PRESIGN_MB)
        ->and($put[0]['expiresAt']->equalTo($intent->expires_at))->toBeTrue();
});

it('needs a signed-in user', function (): void {
    $this->postJson(route('api.uploads.presign'), presignBody())->assertUnauthorized();

    expect(UploadIntent::query()->count())->toBe(0);
});

it('refuses a type outside the purpose allowlist', function (string $contentType): void {
    presign(User::factory()->create(), presignBody(contentType: $contentType, filename: 'me.svg'))
        ->assertUnprocessable()
        ->assertJsonPath('code', 'upload_type_not_allowed')
        ->assertJsonPath('message', trans_icu('uploads.errors.upload_type_not_allowed'));

    expect(UploadIntent::query()->count())->toBe(0);
})->with(['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', 'application/octet-stream', 'IMAGE/PNG; charset=binary']);

it('accepts the declared type whatever its case', function (): void {
    presign(User::factory()->create(), presignBody(contentType: 'Image/PNG'))->assertCreated();

    expect(UploadIntent::query()->sole()->declared_mime)->toBe('image/png');
});

it('refuses an empty file and a file over the limit of the purpose', function (int $size): void {
    presign(User::factory()->create(), presignBody(size: $size))
        ->assertUnprocessable()
        ->assertJsonPath('code', 'file_too_large');

    expect(UploadIntent::query()->count())->toBe(0);
})->with([0, -1, 5 * PRESIGN_MB + 1]);

it('accepts a file of exactly the limit', function (): void {
    presign(User::factory()->create(), presignBody(size: 5 * PRESIGN_MB))->assertCreated()
        ->assertJsonPath('headers.Content-Length', (string) (5 * PRESIGN_MB));
});

it('answers a validation error for a malformed body', function (array $changes, array $without, string $field): void {
    $body = array_diff_key($changes + presignBody(), array_flip($without));

    presign(User::factory()->create(), $body)->assertUnprocessable()->assertJsonValidationErrors([$field]);
})->with([
    'unknown purpose' => [['purpose' => 'selfie'], [], 'purpose'],
    'no purpose' => [[], ['purpose'], 'purpose'],
    'no filename' => [[], ['filename'], 'filename'],
    'filename too long' => [['filename' => str_repeat('a', 256)], [], 'filename'],
    'size not a number' => [['size' => 'big'], [], 'size'],
    'no size' => [[], ['size'], 'size'],
    'no content type' => [[], ['contentType'], 'contentType'],
    'target without an id' => [['target' => ['type' => 'project']], [], 'target.id'],
]);

describe('blueprint_source', function (): void {
    beforeEach(function (): void {
        $this->customer = User::factory()->create();
        $this->project = Project::factory()->forCustomer($this->customer)->create();
    });

    it('refuses a DWG file with its own code, whatever its MIME type', function (string $contentType): void {
        presign($this->customer, presignBody(UploadPurpose::BlueprintSource, 'plan.dwg', $contentType, 2 * PRESIGN_MB, $this->project))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'dwg_not_supported')
            ->assertJsonPath('message', trans_icu('uploads.errors.dwg_not_supported'));
    })->with(['application/octet-stream', 'image/vnd.dwg', 'application/acad']);

    it('refuses an extension outside the list of 06 §2.1', function (string $filename): void {
        presign($this->customer, presignBody(UploadPurpose::BlueprintSource, $filename, 'image/bmp', PRESIGN_MB, $this->project))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'unsupported_type');
    })->with(['photo.bmp', 'scan.tiff', 'drawing.svg', 'noextension', 'plan.dxf.exe']);

    it('accepts a generic MIME type only with the matching extension', function (string $filename, string $contentType, ?string $code): void {
        $response = presign($this->customer, presignBody(UploadPurpose::BlueprintSource, $filename, $contentType, PRESIGN_MB, $this->project));

        if ($code === null) {
            $response->assertCreated();
        } else {
            $response->assertUnprocessable()->assertJsonPath('code', $code);
        }
    })->with([
        'octet-stream dxf' => ['plan.dxf', 'application/octet-stream', null],
        'text dxf' => ['PLAN.DXF', 'text/plain', null],
        'octet-stream heic' => ['IMG_1.heic', 'application/octet-stream', null],
        'octet-stream heif' => ['IMG_1.heif', 'application/octet-stream', null],
        'octet-stream bin' => ['plan.bin', 'application/octet-stream', 'unsupported_type'],
        'octet-stream jpg' => ['photo.jpg', 'application/octet-stream', 'upload_type_not_allowed'],
        'octet-stream pdf' => ['plan.pdf', 'application/octet-stream', 'upload_type_not_allowed'],
        'text heic' => ['IMG_1.heic', 'text/plain', 'upload_type_not_allowed'],
        'dxf mime' => ['plan.dxf', 'image/vnd.dxf', null],
        'pdf' => ['plan.pdf', 'application/pdf', null],
        'jpeg' => ['plan.jpeg', 'image/jpeg', null],
        'heif mime' => ['IMG_1.HEIF', 'image/heif', null],
        'svg mime on a pdf name' => ['plan.pdf', 'image/svg+xml', 'upload_type_not_allowed'],
    ]);

    it('limits DXF to 15 MB and the other kinds to 25 MB', function (string $filename, string $contentType, int $size, bool $accepted): void {
        $response = presign($this->customer, presignBody(UploadPurpose::BlueprintSource, $filename, $contentType, $size, $this->project));

        if ($accepted) {
            $response->assertCreated();
        } else {
            $response->assertUnprocessable()->assertJsonPath('code', 'file_too_large');
        }
    })->with([
        'dxf at the limit' => ['plan.dxf', 'image/vnd.dxf', 15 * PRESIGN_MB, true],
        'dxf over' => ['plan.dxf', 'application/octet-stream', 16 * PRESIGN_MB, false],
        'dxf one byte over' => ['plan.dxf', 'application/dxf', 15 * PRESIGN_MB + 1, false],
        'pdf at the limit' => ['plan.pdf', 'application/pdf', 25 * PRESIGN_MB, true],
        'pdf over' => ['plan.pdf', 'application/pdf', 25 * PRESIGN_MB + 1, false],
        'heic over' => ['x.heic', 'image/heic', 26 * PRESIGN_MB, false],
    ]);

    it('stores the project as the target of the intent', function (): void {
        presign($this->customer, presignBody(UploadPurpose::BlueprintSource, 'plan.pdf', 'application/pdf', PRESIGN_MB, $this->project))->assertCreated();

        $intent = UploadIntent::query()->sole();
        expect($intent->target_type)->toBe('project')->and($intent->target_id)->toBe($this->project->id)
            ->and($intent->object_key)->toStartWith('tmp/blueprint_source/2030/06/');
    });
});

describe('targets', function (): void {
    it('answers 404 for another customer\'s project and records nothing', function (): void {
        $project = Project::factory()->create();

        presign(User::factory()->create(), presignBody(UploadPurpose::ProjectCover, 'cover.png', 'image/png', PRESIGN_MB, $project))->assertNotFound();

        expect(UploadIntent::query()->count())->toBe(0);
    });

    it('accepts the owner\'s project, and staff with customers.manage', function (string $actor): void {
        $project = Project::factory()->create();
        $user = $actor === 'owner' ? $project->owner : User::factory()->admin()->create();

        presign($user, presignBody(UploadPurpose::ProjectCover, 'cover.webp', 'image/webp', PRESIGN_MB, $project))->assertCreated();
    })->with(['owner', 'admin']);

    it('answers 404 for a target that does not exist and 422 for a missing or wrong one', function (): void {
        $customer = User::factory()->create();
        $project = Project::factory()->forCustomer($customer)->create();
        $body = presignBody(UploadPurpose::ProjectCover, 'cover.png', 'image/png', PRESIGN_MB, $project);

        presign($customer, ['target' => ['type' => 'project', 'id' => '01J0000000000000000000000X']] + $body)->assertNotFound();
        presign($customer, ['target' => null] + $body)->assertUnprocessable()->assertJsonPath('code', 'invalid_target');
        presign($customer, ['target' => ['type' => 'plan', 'id' => $project->id]] + $body)->assertUnprocessable()->assertJsonPath('code', 'invalid_target');
        presign($customer, ['target' => ['type' => 'App\\Domain\\Projects\\Models\\Project', 'id' => $project->id]] + $body)->assertUnprocessable()->assertJsonPath('code', 'invalid_target');
        presign($customer, array_diff_key($body, ['target' => 1]))->assertUnprocessable()->assertJsonPath('code', 'invalid_target');

        expect(UploadIntent::query()->count())->toBe(0);
    });

    it('ignores a target on a purpose that has none', function (): void {
        $project = Project::factory()->create();

        presign(User::factory()->create(), presignBody(target: $project))->assertCreated();

        expect(UploadIntent::query()->sole())->target_type->toBeNull()->target_id->toBeNull();
    });

    it('checks the order of a message attachment, a production photo and an issue photo', function (): void {
        $order = Order::factory()->create();
        $stranger = User::factory()->create();

        presign($stranger, presignBody(UploadPurpose::MessageAttachment, 'a.pdf', 'application/pdf', PRESIGN_MB, $order))->assertNotFound();
        presign($order->customer, presignBody(UploadPurpose::MessageAttachment, 'a.pdf', 'application/pdf', PRESIGN_MB, $order))->assertCreated();
        presign($order->customer, presignBody(UploadPurpose::ProductionPhoto, 'a.jpg', 'image/jpeg', PRESIGN_MB, $order))->assertForbidden();
        presign(User::factory()->production()->create(), presignBody(UploadPurpose::ProductionPhoto, 'a.jpg', 'image/jpeg', PRESIGN_MB, $order))->assertCreated();
        presign($order->customer, presignBody(UploadPurpose::IssuePhoto, 'a.heic', 'image/heic', PRESIGN_MB, $order))->assertCreated();
        presign(User::factory()->production()->create(), presignBody(UploadPurpose::IssuePhoto, 'a.heic', 'image/heic', PRESIGN_MB, $order))->assertForbidden();
        presign(User::factory()->admin()->create(), presignBody(UploadPurpose::IssuePhoto, 'a.heic', 'image/heic', PRESIGN_MB, $order))->assertCreated();
    });

    it('checks the plan, the furniture design and the project for thumbnails and covers', function (): void {
        $plan = Plan::factory()->create();
        $design = FurnitureDesign::factory()->create();

        presign(User::factory()->create(), presignBody(UploadPurpose::PlanThumbnail, 't.png', 'image/png', PRESIGN_MB, $plan))->assertNotFound();
        presign($plan->project->owner, presignBody(UploadPurpose::PlanThumbnail, 't.png', 'image/png', PRESIGN_MB, $plan))->assertCreated();
        presign(User::factory()->create(), presignBody(UploadPurpose::FurnitureThumbnail, 't.png', 'image/png', PRESIGN_MB, $design))->assertNotFound();
        presign($design->project->owner, presignBody(UploadPurpose::FurnitureThumbnail, 't.png', 'image/png', PRESIGN_MB, $design))->assertCreated();
    });
});

describe('staff purposes', function (): void {
    it('lets admins upload a business logo and keeps estimators and customers out', function (string $actor, int $status): void {
        $user = match ($actor) {
            'admin' => User::factory()->admin()->create(),
            'estimator' => User::factory()->estimator()->create(),
            'customer' => User::factory()->create(),
        };

        presign($user, presignBody(UploadPurpose::BusinessLogo, 'logo.png', 'image/png', PRESIGN_MB))->assertStatus($status);

        expect(UploadIntent::query()->count())->toBe($status === 201 ? 1 : 0);
    })->with([['admin', 201], ['estimator', 403], ['customer', 403]]);

    it('lets the staff with the permission upload catalogue images', function (UploadPurpose $purpose, string $contentType): void {
        presign(User::factory()->admin()->create(), presignBody($purpose, 'texture.jpg', $contentType, PRESIGN_MB))->assertCreated();
        presign(User::factory()->estimator()->create(), presignBody($purpose, 'texture.jpg', $contentType, PRESIGN_MB))->assertForbidden();
        presign(User::factory()->create(), presignBody($purpose, 'texture.jpg', $contentType, PRESIGN_MB))->assertForbidden();
    })->with([
        [UploadPurpose::MaterialTexture, 'image/jpeg'],
        [UploadPurpose::FinishTexture, 'image/webp'],
        [UploadPurpose::HardwareImage, 'image/png'],
    ]);

    it('lets the staff with presets.manage upload a preset thumbnail', function (): void {
        presign(User::factory()->estimator()->create(), presignBody(UploadPurpose::PresetThumbnail, 't.png', 'image/png', PRESIGN_MB))->assertCreated();
        presign(User::factory()->production()->create(), presignBody(UploadPurpose::PresetThumbnail, 't.png', 'image/png', PRESIGN_MB))->assertForbidden();
    });
});

it('limits presigns to 30 a minute per user', function (): void {
    $user = User::factory()->create();
    $other = User::factory()->create();

    foreach (range(1, 30) as $_) {
        presign($user, presignBody(size: 1000))->assertCreated();
    }

    presign($user, presignBody(size: 1000))
        ->assertTooManyRequests()
        ->assertJsonPath('code', 'rate_limited')
        ->assertHeader('Retry-After');
    presign($other, presignBody(size: 1000))->assertCreated();

    expect(UploadIntent::query()->where('user_id', $user->id)->count())->toBe(30);

    $this->travel(61)->seconds();
    presign($user, presignBody(size: 1000))->assertCreated();
});
