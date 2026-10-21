<?php

declare(strict_types=1);

use App\Rules\TurnstileToken;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

/** The first error the rule gives `$token`, or null when it passes. */
function turnstileError(?string $token, string $action = 'register', bool $failOpen = true): ?string
{
    $validator = Validator::make(
        ['cf_turnstile_response' => $token],
        ['cf_turnstile_response' => [new TurnstileToken($action, $failOpen)]],
    );

    return $validator->errors()->first('cf_turnstile_response') ?: null;
}

/** Fakes the answer of Cloudflare: a success for this site and the register form, with `$answer` on top. */
function fakeCloudflare(array $answer = [], int $status = 200): void
{
    Http::fake([
        'challenges.cloudflare.com/*' => Http::response([
            'success' => true,
            'hostname' => parse_url((string) config('app.url'), PHP_URL_HOST),
            'action' => 'register',
            ...$answer,
        ], $status),
    ]);
}

beforeEach(function (): void {
    config(['app.url' => 'https://furny.example.com', 'services.turnstile.site_key' => 'site-key', 'services.turnstile.secret_key' => 'secret-key']);
});

describe('while features.captcha is off', function (): void {
    it('passes without a token and never calls Cloudflare', function (?string $token): void {
        config(['services.turnstile.site_key' => null, 'services.turnstile.secret_key' => null]);
        Http::fake();

        expect(turnstileError($token))->toBeNull();
        Http::assertNothingSent();
    })->with(['no token' => null, 'empty token' => '', 'a token' => 'anything']);

    it('is off when only one of the two keys is set', function (): void {
        config(['services.turnstile.secret_key' => '']);
        Http::fake();

        expect(turnstileError(null))->toBeNull();
        Http::assertNothingSent();
    });
});

describe('while features.captcha is on', function (): void {
    it('passes a token that Cloudflare confirms for this host and this form', function (): void {
        fakeCloudflare();

        expect(turnstileError('the-token'))->toBeNull();
    });

    it('asks Cloudflare with the secret, the token, the visitor IP and a fresh idempotency key', function (): void {
        fakeCloudflare();
        $this->app['request']->server->set('REMOTE_ADDR', '203.0.113.45');

        turnstileError('the-token');
        turnstileError('the-token');

        $keys = [];
        Http::assertSentCount(2);
        Http::assertSent(function (Request $request) use (&$keys): bool {
            $keys[] = $request['idempotency_key'];

            return $request->url() === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
                && $request->method() === 'POST'
                && $request->isForm()
                && $request['secret'] === 'secret-key'
                && $request['response'] === 'the-token'
                && $request['remoteip'] === '203.0.113.45';
        });

        expect($keys[0])->toMatch('/^[0-9a-f-]{36}$/')->and($keys[1])->not->toBe($keys[0]);
    });

    it('fails a token of another form', function (): void {
        fakeCloudflare(['action' => 'password_reset']);

        expect(turnstileError('the-token'))->toBe(__('auth.captcha_failed'));
    });

    it('fails a token with no form at all', function (): void {
        fakeCloudflare(['action' => null]);

        expect(turnstileError('the-token'))->toBe(__('auth.captcha_failed'));
    });

    it('fails a token that was issued for another host', function (string $hostname): void {
        fakeCloudflare(['hostname' => $hostname]);

        expect(turnstileError('the-token'))->toBe(__('auth.captcha_failed'));
    })->with(['another host' => 'evil.example.com', 'a longer host' => 'furny.example.com.evil.test', 'none' => '']);

    it('compares the host without regard to case', function (): void {
        fakeCloudflare(['hostname' => 'FURNY.example.com']);

        expect(turnstileError('the-token'))->toBeNull();
    });

    it('fails a token that Cloudflare rejects', function (): void {
        fakeCloudflare(['success' => false, 'error-codes' => ['invalid-input-response']]);

        expect(turnstileError('the-token'))->toBe(__('auth.captcha_failed'));
    });

    it('fails when success is not exactly true', function (mixed $success): void {
        fakeCloudflare(['success' => $success]);

        expect(turnstileError('the-token'))->toBe(__('auth.captcha_failed'));
    })->with(['the text true' => 'true', 'one' => 1, 'null' => null]);

    it('fails an answer that is not JSON', function (): void {
        Http::fake(['challenges.cloudflare.com/*' => Http::response('<html>nope</html>')]);

        expect(turnstileError('the-token'))->toBe(__('auth.captcha_failed'));
    });

    it('fails a missing token without calling Cloudflare', function (?string $token): void {
        Http::fake();

        expect(turnstileError($token))->toBe(__('auth.captcha_failed'));
        Http::assertNothingSent();
    })->with(['no token' => null, 'empty token' => '']);

    it('fails a token that is not text', function (): void {
        Http::fake();

        $validator = Validator::make(['cf_turnstile_response' => ['a']], ['cf_turnstile_response' => [new TurnstileToken('register', true)]]);

        expect($validator->fails())->toBeTrue();
        Http::assertNothingSent();
    });
});

describe('when Cloudflare cannot be reached', function (): void {
    beforeEach(function (): void {
        Log::spy();
    });

    it('lets the request through and logs captcha.unavailable when it fails open', function (): void {
        Http::fake(fn () => throw new ConnectionException('timed out'));

        expect(turnstileError('the-token', failOpen: true))->toBeNull();

        Log::shouldHaveReceived('warning')->with('captcha.unavailable', Mockery::on(fn (array $context): bool => $context['form'] === 'register'))->once();
    });

    it('fails with auth.captcha_unavailable when it fails closed', function (): void {
        Http::fake(fn () => throw new ConnectionException('timed out'));

        expect(turnstileError('the-token', 'otp_send', failOpen: false))->toBe(__('auth.captcha_unavailable'));

        Log::shouldHaveReceived('warning')->with('captcha.unavailable', Mockery::on(fn (array $context): bool => $context['form'] === 'otp_send'))->once();
    });

    it('treats a server error of Cloudflare as unavailable, by the same rule', function (): void {
        fakeCloudflare(status: 503);

        expect(turnstileError('the-token', failOpen: true))->toBeNull()
            ->and(turnstileError('the-token', failOpen: false))->toBe(__('auth.captcha_unavailable'));

        Log::shouldHaveReceived('warning')->with('captcha.unavailable', Mockery::type('array'))->twice();
    });

    it('logs neither the token nor the secret', function (): void {
        Http::fake(fn () => throw new ConnectionException('timed out'));

        turnstileError('the-token');

        Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context): bool => ! str_contains(json_encode($context), 'the-token') && ! str_contains(json_encode($context), 'secret-key'))->once();
    });
});
