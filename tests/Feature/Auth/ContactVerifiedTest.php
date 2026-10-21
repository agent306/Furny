<?php

declare(strict_types=1);

use App\Domain\Identity\Events\ContactVerified;
use App\Domain\Identity\Models\User;
use App\Domain\Identity\Support\ContactVerification;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\URL;

describe('the first verified contact (13 section 5.6)', function (): void {
    beforeEach(function (): void {
        Event::fake([ContactVerified::class]);
        $this->contacts = app(ContactVerification::class);
    });

    it('dispatches ContactVerified once for the first email verification', function (): void {
        $user = User::factory()->unverified()->create();

        $this->contacts->markEmailVerified($user);

        Event::assertDispatchedTimes(ContactVerified::class, 1);
        Event::assertDispatched(ContactVerified::class, fn (ContactVerified $event): bool => $event->user->is($user));
        expect($user->refresh()->email_verified_at)->not->toBeNull()
            ->and($user->email_verified_at->diffInSeconds(now()))->toBeLessThan(5);
    });

    it('does not dispatch it for a later phone verification', function (): void {
        $user = User::factory()->unverified()->create();

        $this->contacts->markEmailVerified($user);
        $this->contacts->markPhoneVerified($user->refresh());

        Event::assertDispatchedTimes(ContactVerified::class, 1);
        expect($user->refresh()->phone_verified_at)->not->toBeNull();
    });

    it('does not dispatch it for a later email verification after the phone', function (): void {
        $user = User::factory()->unverified()->create(['phone_e164' => '+919876543210']);

        $this->contacts->markPhoneVerified($user);
        $this->contacts->markEmailVerified($user->refresh());

        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('dispatches it for an account created already verified: markPhoneVerified on a new user with both timestamps null', function (): void {
        $user = User::factory()->phoneOnly()->create(['phone_verified_at' => null, 'first_contact_verified_at' => null]);

        expect($user->email_verified_at)->toBeNull()->and($user->phone_verified_at)->toBeNull();

        $this->contacts->markPhoneVerified($user);

        Event::assertDispatchedTimes(ContactVerified::class, 1);
        expect($user->refresh()->phone_verified_at)->not->toBeNull();
    });

    it('does not dispatch it when a contact was verified before (an email verified again)', function (): void {
        $user = User::factory()->create();

        $this->contacts->markEmailVerified($user);

        Event::assertNotDispatched(ContactVerified::class);
    });

    it('sets the timestamp again for a verification that is repeated, and dispatches nothing', function (): void {
        $user = User::factory()->create(['email_verified_at' => now()->subYear()]);

        $this->contacts->markPhoneVerified($user);

        Event::assertNotDispatched(ContactVerified::class);
        expect($user->refresh()->phone_verified_at)->not->toBeNull();
    });
});

describe('once per user (first_contact_verified_at)', function (): void {
    beforeEach(function (): void {
        Event::fake([ContactVerified::class]);
        $this->contacts = app(ContactVerification::class);
    });

    it('stamps the first verification and keeps that moment', function (): void {
        $user = User::factory()->unverified()->create();

        $this->contacts->markEmailVerified($user);
        $first = $user->refresh()->first_contact_verified_at;

        $this->travel(2)->days();
        $this->contacts->markPhoneVerified($user);

        expect($first)->not->toBeNull()
            ->and($user->refresh()->first_contact_verified_at->equalTo($first))->toBeTrue();
    });

    it('does not dispatch again when a verified email is changed and the new one is verified', function (): void {
        $user = User::factory()->unverified()->create();

        $this->contacts->markEmailVerified($user);
        // The email changes: it starts unverified, and the user has no verified contact until the link is opened.
        $user->forceFill(['email' => 'new@example.com', 'email_verified_at' => null])->save();
        $this->contacts->markEmailVerified($user);

        Event::assertDispatchedTimes(ContactVerified::class, 1);
        expect($user->refresh()->email_verified_at)->not->toBeNull();
    });

    it('does not dispatch again for the whole path: profile change, then the emailed link', function (): void {
        $user = User::factory()->unverified()->create(['email' => 'asha@example.com']);
        $this->contacts->markEmailVerified($user);

        $this->actingAs($user->refresh())
            ->withSession(['auth.login_at' => now()->getTimestamp()])
            ->put(route('user-profile-information.update'), ['name' => $user->name, 'email' => 'new@example.com'])
            ->assertRedirect();

        $link = URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), [
            'id' => $user->getKey(),
            'hash' => sha1('new@example.com'),
        ]);
        $this->actingAs($user->refresh())->get($link)->assertRedirect();

        expect($user->refresh()->email_verified_at)->not->toBeNull();
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('does not dispatch when another request got there first, even for a model that has not heard of it', function (): void {
        $user = User::factory()->unverified()->create();
        DB::table('users')->where('id', $user->getKey())->update(['first_contact_verified_at' => now()->subMinute()]);

        $this->contacts->markEmailVerified($user);

        Event::assertNotDispatched(ContactVerified::class);
    });

    it('has nothing to verify for an email that is not there', function (): void {
        $user = User::factory()->phoneOnly()->create(['phone_verified_at' => null, 'first_contact_verified_at' => null]);

        $this->contacts->markEmailVerified($user);

        Event::assertNotDispatched(ContactVerified::class);
        expect($user->refresh()->email_verified_at)->toBeNull()->and($user->first_contact_verified_at)->toBeNull();
    });
});

describe('after the commit', function (): void {
    beforeEach(function (): void {
        $this->heard = 0;
        Event::listen(ContactVerified::class, function (): void {
            $this->heard++;
        });
    });

    it('holds the event back while the surrounding transaction is open', function (): void {
        $user = User::factory()->unverified()->create();

        DB::transaction(function () use ($user): void {
            app(ContactVerification::class)->markEmailVerified($user);

            expect($this->heard)->toBe(0);
        });

        expect($this->heard)->toBe(1);
    });

    it('drops the event, and the timestamp, when the surrounding transaction rolls back', function (): void {
        $user = User::factory()->unverified()->create();

        try {
            DB::transaction(function () use ($user): void {
                app(ContactVerification::class)->markEmailVerified($user);

                throw new RuntimeException('rolled back');
            });
        } catch (RuntimeException) {
            // expected
        }

        expect($this->heard)->toBe(0)->and($user->fresh()->email_verified_at)->toBeNull();
    });

    it('is a ShouldDispatchAfterCommit event', function (): void {
        expect(ContactVerified::class)->toImplement(ShouldDispatchAfterCommit::class);
    });
});

describe('the user model', function (): void {
    beforeEach(fn () => Event::fake([ContactVerified::class]));

    it('verifies through ContactVerification', function (): void {
        $user = User::factory()->unverified()->create();

        expect($user->markEmailAsVerified())->toBeTrue()
            ->and($user->hasVerifiedEmail())->toBeTrue();
        Event::assertDispatchedTimes(ContactVerified::class, 1);
    });

    it('has nothing to verify without an email', function (): void {
        $user = User::factory()->phoneOnly()->create();

        expect($user->markEmailAsVerified())->toBeFalse();
        Event::assertNotDispatched(ContactVerified::class);
    });
});
