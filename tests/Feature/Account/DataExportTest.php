<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\ChangeProposal;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\ProductionUpdate;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\Models\QuoteLine;
use App\Domain\Orders\States\Submitted;
use App\Domain\Projects\Models\PlanRevision;
use App\Domain\Projects\Models\Project;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\AccountDataFixture;
use Tests\Support\SessionStamp;

beforeEach(function (): void {
    Storage::fake('s3');
    Storage::fake('s3-public');
    $this->fixture = AccountDataFixture::create(null);
    $this->user = $this->fixture->user;
    $this->export = fn (?User $as = null) => $this->actingAs($as ?? $this->user)->withSession(SessionStamp::loginHoursAgo(0))->get(route('customer.account.export'));
});

/** @return array<string, mixed> */
function exported(TestResponse $response): array
{
    return json_decode($response->streamedContent(), true, flags: JSON_THROW_ON_ERROR);
}

it('has the route of 14 §9', function (): void {
    expect(route('customer.account.export', absolute: false))->toBe('/account/export');
});

it('downloads a versioned JSON file named after the app and the day', function (): void {
    $response = ($this->export)()->assertOk();

    expect($response->headers->get('Content-Type'))->toStartWith('application/json')
        ->and($response->headers->get('Content-Disposition'))->toMatch('/^attachment; filename=.*-export-\d{4}-\d{2}-\d{2}\.json$/')
        ->and($response->headers->get('Content-Disposition'))->toContain(Str::slug((string) config('app.name')).'-export-'.now()->format('Y-m-d').'.json');

    $data = exported($response);
    expect($data['version'])->toBe(1)
        ->and($data)->toHaveKeys(['version', 'exportedAt', 'profile', 'addresses', 'notificationPreferences', 'projects', 'orders', 'aiCreditLedger', 'media']);
});

it('has the profile without passwords, tokens, two-factor secrets and internal notes', function (): void {
    $profile = exported(($this->export)())['profile'];

    expect($profile['email'])->toBe('asha.krishnan@example.com')
        ->and($profile['name'])->toBe('Asha Krishnan')
        ->and($profile['phoneE164'])->toBe(AccountDataFixture::PHONE);

    foreach (['password', 'rememberToken', 'remember_token', 'twoFactorSecret', 'two_factor_secret', 'twoFactorRecoveryCodes', 'two_factor_recovery_codes', 'notesInternal', 'notes_internal'] as $key) {
        expect($profile)->not->toHaveKey($key);
    }
});

it('leaks no secret anywhere in the file', function (): void {
    $raw = ($this->export)()->streamedContent();

    expect($raw)->not->toContain((string) $this->user->getRawOriginal('password'))
        ->not->toContain((string) $this->user->getRawOriginal('remember_token'))
        ->not->toContain('Prefers calls after 6 pm.')
        ->not->toContain('JBSWY3DPEHPK3PXP');
});

it('exports messages without the internal notes', function (): void {
    $internal = Message::factory()->internalNote()->create(['order_id' => $this->fixture->order->id, 'body' => 'Customer is difficult, quote high.']);

    $orders = exported(($this->export)())['orders'];

    $bodies = array_column($orders[0]['messages'], 'body');
    expect($bodies)->toContain('Please use the service lift.')->not->toContain($internal->body);
});

it('exports the quotes that were sent, with the lines the customer sees, and never the costs', function (): void {
    $draft = Quote::factory()->create(['order_id' => $this->fixture->order->id, 'internal_notes' => 'margin 40%', 'cost_snapshot' => ['marginPct' => 40]]);
    $this->fixture->quote->forceFill(['internal_notes' => 'margin 40%', 'cost_snapshot' => ['marginPct' => 40]])->save();
    QuoteLine::factory()->create(['quote_id' => $this->fixture->quote->id, 'description' => 'Wardrobe', 'is_visible_to_customer' => true]);
    QuoteLine::factory()->create(['quote_id' => $this->fixture->quote->id, 'description' => 'Hidden labour cost', 'is_visible_to_customer' => false]);

    $response = ($this->export)();
    $raw = $response->streamedContent();
    $quotes = json_decode($raw, true, flags: JSON_THROW_ON_ERROR)['orders'][0]['quotes'];

    expect(array_column($quotes, 'id'))->toBe([$this->fixture->quote->id])
        ->and($quotes[0]['acceptedByIp'])->toBe(AccountDataFixture::IP)
        ->and(array_column($quotes[0]['lines'], 'description'))->toBe(['Wardrobe'])
        ->and($raw)->not->toContain($draft->id)->not->toContain('margin 40%')->not->toContain('marginPct')->not->toContain('Hidden labour cost');
});

it('exports the proposals that were sent and not the drafts, and the updates the customer can see', function (): void {
    $draft = ChangeProposal::factory()->create(['order_id' => $this->fixture->order->id, 'message' => 'Draft idea']);
    $sent = ChangeProposal::factory()->sent()->create(['order_id' => $this->fixture->order->id, 'message' => 'Please shorten the wardrobe']);
    ProductionUpdate::factory()->create(['order_id' => $this->fixture->order->id, 'title' => 'Carcasses cut']);
    ProductionUpdate::factory()->internal()->create(['order_id' => $this->fixture->order->id, 'title' => 'Saw blade broke']);

    $order = exported(($this->export)())['orders'][0];

    expect(array_column($order['changeProposals'], 'id'))->toBe([$sent->id])
        ->and(array_column($order['productionUpdates'], 'title'))->toBe(['Carcasses cut'])
        ->and(json_encode($order))->not->toContain($draft->message);
});

it('exports the addresses, projects with their plans and designs, imports and the ledger', function (): void {
    $data = exported(($this->export)());

    expect(array_column($data['addresses'], 'line1'))->toContain('12 MG Road', '7 Lake View')
        ->and(array_column($data['projects'], 'name'))->toContain('Old flat', 'Whitefield villa')
        ->and($data['aiCreditLedger'])->toHaveCount(1)
        ->and($data['notificationPreferences'])->toHaveCount(1);

    $kept = collect($data['projects'])->firstWhere('name', 'Whitefield villa');
    expect($kept['plans'][0])->toHaveKeys(['workingDocument', 'revisions'])
        ->and($kept['furnitureDesigns'][0]['name'])->toBe('Master wardrobe')
        ->and($kept['imports'][0]['originalFilename'])->toBe('villa-scan.pdf')
        ->and($kept['imports'][0])->not->toHaveKey('resultDocument');
});

it('lists the plan revisions without their documents', function (): void {
    PlanRevision::factory()->create(['plan_id' => $this->fixture->keptPlan->id, 'number' => 1]);

    $kept = collect(exported(($this->export)())['projects'])->firstWhere('name', 'Whitefield villa');

    expect($kept['plans'][0]['revisions'])->toHaveCount(1)
        ->and($kept['plans'][0]['revisions'][0])->not->toHaveKey('document');
});

it('lists the media as metadata only', function (): void {
    $media = exported(($this->export)())['media'];

    expect($media)->not->toBe([]);

    foreach ($media as $item) {
        expect(array_keys($item))->toEqualCanonicalizing(['collection', 'fileName', 'size', 'createdAt']);
    }

    expect(array_column($media, 'collection'))->toContain('avatar', 'thumbnail');
});

it('leaves out what belongs to another customer', function (): void {
    $other = User::factory()->create(['name' => 'Ravi Other']);
    $project = Project::factory()->forCustomer($other)->create(['name' => 'Ravi flat']);
    $order = Order::factory()->state(['project_id' => $project->id])->inState(Submitted::class)->create();
    Message::factory()->create(['order_id' => $order->id, 'body' => 'Ravi private words']);

    $raw = ($this->export)()->streamedContent();
    $data = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);

    expect(array_column($data['orders'], 'id'))->toBe([$this->fixture->order->id])
        ->and($raw)->not->toContain('Ravi');
});

it('is audited', function (): void {
    ($this->export)()->streamedContent();

    $activity = Activity::query()->where('event', 'account.data_exported')->sole();
    expect($activity->subject_id)->toBe($this->user->id)->and($activity->causer_id)->toBe($this->user->id);
});

it('needs a verified email or phone', function (): void {
    $unverified = User::factory()->unverified()->create();

    $this->actingAs($unverified)->withSession(SessionStamp::loginHoursAgo(0))
        ->getJson(route('customer.account.export'))
        ->assertForbidden()
        ->assertExactJson(['code' => 'contact_unverified']);
});

it('needs a recent authentication', function (): void {
    $this->actingAs($this->user)->get(route('customer.account.export'))->assertRedirectToRoute('password.confirm');
});

it('is for customers only', function (): void {
    $this->actingAs(User::factory()->owner()->create())->get(route('customer.account.export'))->assertRedirectToRoute('admin.dashboard');
});

it('allows three exports a day per customer and answers the fourth with 429', function (): void {
    foreach (range(1, 3) as $_) {
        ($this->export)()->assertOk()->streamedContent();
    }

    $this->actingAs($this->user)->withSession(SessionStamp::loginHoursAgo(0))
        ->getJson(route('customer.account.export'))
        ->assertStatus(429)
        ->assertJsonPath('code', 'rate_limited');

    $other = User::factory()->create();
    ($this->export)($other)->assertOk();
});
