<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/** The reset and verification mails go through the queue, encrypted (13 §5.5, §5.6; 12 §3.3). */
beforeEach(function (): void {
    // The suite runs queues synchronously; these tests want the jobs to wait in the table.
    config(['queue.default' => 'database']);
    $this->user = User::factory()->unverified()->create(['email' => 'asha@example.com']);
    $this->forgot = fn (string $email) => $this->post(route('password.email'), ['email' => $email]);
    // Runs the queued mail job and returns the message it sent.
    $this->deliver = function (): string {
        Artisan::call('queue:work', ['connection' => 'database', '--once' => true, '--quiet' => true]);

        $messages = Mail::mailer('array')->getSymfonyTransport()->messages();

        return $messages->isEmpty() ? '' : $messages->last()->getOriginalMessage()->toString();
    };
});

it('does not send the reset mail while the request runs, and answers the same for an unknown address', function (): void {
    Mail::mailer('array')->getSymfonyTransport()->flush();

    ($this->forgot)('asha@example.com')->assertRedirect()->assertSessionHas('status', trans('passwords.sent_generic'));
    ($this->forgot)('nobody@example.com')->assertRedirect()->assertSessionHas('status', trans('passwords.sent_generic'));

    expect(DB::table('jobs')->count())->toBe(1)
        ->and(Mail::mailer('array')->getSymfonyTransport()->messages())->toHaveCount(0);
});

it('does not let a failing mail transport reach the request', function (): void {
    // A transport that cannot connect: sent in the request, this would be a 500 for a known address only.
    config([
        'mail.default' => 'smtp',
        'mail.mailers.smtp' => ['transport' => 'smtp', 'host' => '127.0.0.1', 'port' => 1, 'timeout' => 1],
    ]);

    ($this->forgot)('asha@example.com')->assertRedirect()->assertSessionHas('status', trans('passwords.sent_generic'))->assertSessionHasNoErrors();
    $this->actingAs($this->user)->post(route('verification.send'))->assertRedirect();

    expect(DB::table('jobs')->count())->toBe(2);
});

it('keeps the reset token out of the queue payload, and sends it in the mail', function (): void {
    ($this->forgot)('asha@example.com')->assertRedirect();

    $payload = (string) DB::table('jobs')->value('payload');
    $mail = ($this->deliver)();

    preg_match('~/reset-password/([A-Za-z0-9]+)~', $mail, $match);
    $token = $match[1] ?? '';

    expect($token)->not->toBe('')
        ->and($payload)->not->toContain($token)
        ->and($payload)->not->toContain('asha@example.com')
        ->and(json_decode($payload, true)['data']['command'])->not->toStartWith('O:');
});

it('keeps the signed verification link out of the queue payload, and sends it in the mail', function (): void {
    $this->user->sendEmailVerificationNotification();

    $payload = (string) DB::table('jobs')->value('payload');
    $mail = ($this->deliver)();

    preg_match('~signature=([a-f0-9]+)~', str_replace('=\r\n', '', quoted_printable_decode($mail)), $match);
    $signature = $match[1] ?? '';

    expect($signature)->not->toBe('')
        ->and($payload)->not->toContain($signature)
        ->and(json_decode($payload, true)['data']['command'])->not->toStartWith('O:');
});
