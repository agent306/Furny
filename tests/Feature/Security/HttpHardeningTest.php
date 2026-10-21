<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use App\Providers\TelescopeServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Laravel\Pulse\Facades\Pulse;
use Laravel\Telescope\Telescope;

it('never flashes secrets back into the form after a validation error', function (): void {
    Route::middleware('web')->post('/_form', function (Request $request) {
        $request->validate(['name' => 'required']);
    });

    $this->post('/_form', [
        'title' => 'kept',
        'password' => 'hunter2',
        'password_confirmation' => 'hunter2',
        'current_password' => 'old-hunter2',
        'code' => '123456',
        'cf_turnstile_response' => 'turnstile-token',
    ])->assertSessionHasErrors('name')->assertSessionHasInput('title', 'kept');

    foreach (['password', 'password_confirmation', 'current_password', 'code', 'cf_turnstile_response'] as $key) {
        $this->assertNull(session()->getOldInput($key), "{$key} was flashed");
    }
});

describe('Pulse user cards', function (): void {
    /** @return array<string, mixed> */
    function pulseCard(User $user): array
    {
        $card = Pulse::resolveUsers(collect([(string) $user->getKey()]))->find((string) $user->getKey());

        return (array) $card;
    }

    it('shows a staff member by name', function (): void {
        $staff = User::factory()->admin()->create(['name' => 'Ravi Menon']);

        expect(pulseCard($staff))->toMatchArray(['name' => 'Ravi Menon', 'extra' => '', 'avatar' => null]);
    });

    it('shows a customer only as Customer … plus the last six characters of the id', function (): void {
        $customer = User::factory()->create(['name' => 'Asha Kumar', 'email' => 'asha@example.com']);
        $card = pulseCard($customer);

        expect($card['name'])->toBe('Customer …'.substr((string) $customer->getKey(), -6))
            ->and($card)->toMatchArray(['extra' => '', 'avatar' => null])
            ->and(json_encode($card))->not->toContain('Asha')->not->toContain('asha@example.com');
    });
});

it('hides secrets from Telescope', function (): void {
    $parameters = Telescope::$hiddenRequestParameters;
    $headers = Telescope::$hiddenRequestHeaders;

    try {
        (new TelescopeServiceProvider($this->app))->register();

        expect(Telescope::$hiddenRequestParameters)
            ->toContain('_token', 'password', 'password_confirmation', 'current_password', 'code', 'cf_turnstile_response')
            ->and(Telescope::$hiddenRequestHeaders)->toContain('authorization', 'cookie', 'x-xsrf-token');
    } finally {
        Telescope::$hiddenRequestParameters = $parameters;
        Telescope::$hiddenRequestHeaders = $headers;
    }
});
