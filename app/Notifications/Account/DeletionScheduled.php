<?php

declare(strict_types=1);

namespace App\Notifications\Account;

use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * `account.deletion_scheduled` (12 §3.3): the mail a customer gets when they ask to delete their account, sent before
 * the soft delete (13 §9.1). Transactional: no preferences, no unsubscribe, not stored in `notifications`, and no
 * WhatsApp. A customer without an email address (phone sign-in only) gets nothing; the page they land on says the same.
 * The queue restores the soft-deleted user by id, so the job can run after the deletion.
 */
final class DeletionScheduled extends Notification implements ShouldQueue
{
    use Queueable;

    public const string EVENT_KEY = 'account.deletion_scheduled';

    /** The format of dates in notifications (12 §3.5). */
    private const string DATE_FORMAT = 'd M Y, H:i';

    private const string TITLE_KEY = 'notifications.account.deletion_scheduled.customer.title';

    private const string BODY_KEY = 'notifications.account.deletion_scheduled.customer.body';

    public function __construct(public readonly CarbonImmutable $anonymiseOn)
    {
        $this->afterCommit();
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return $notifiable instanceof User && $notifiable->email !== null ? ['mail'] : [];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $params = $this->params();

        return (new MailMessage)
            ->subject(trans_icu(self::TITLE_KEY, $params))
            ->greeting(trans_icu(self::TITLE_KEY, $params))
            ->line(trans_icu(self::BODY_KEY, $params));
    }

    /** @return array<string, string> */
    private function params(): array
    {
        $business = app(Settings::class)->business();

        return [
            'appName' => (string) config('app.name'),
            'date' => $this->anonymiseOn->setTimezone($business->timezone)->format(self::DATE_FORMAT),
            'businessEmail' => $business->email,
        ];
    }
}
