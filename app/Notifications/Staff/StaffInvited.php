<?php

declare(strict_types=1);

namespace App\Notifications\Staff;

use App\Domain\Identity\Models\StaffInvitation;
use App\Support\Settings\Settings;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\URL;

/**
 * `staff.invited` (12 §3.3): the mail that invites someone to join the staff, sent to the invited address on demand
 * (`Notification::route('mail', ...)`: the invitee is not a user yet). Transactional: no preferences, no unsubscribe.
 * The link is the temporary signed `staff.invitations.show` route and works until the invitation expires (13 §5.9, §13).
 * Queued and encrypted like the other mails that carry a credential.
 */
final class StaffInvited extends Notification implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable, SerializesModels;

    public const string EVENT_KEY = 'staff.invited';

    /** The format of dates in notifications (12 §4.5). */
    private const string DATE_FORMAT = 'd M Y, H:i';

    public function __construct(public readonly StaffInvitation $invitation)
    {
        $this->afterCommit();
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $params = $this->params();

        return (new MailMessage)
            ->subject(trans_icu('notifications.staff.invited.staff.title', $params))
            ->greeting(trans_icu('notifications.staff.invited.staff.title', $params))
            ->line(trans_icu('notifications.staff.invited.staff.body', $params))
            ->action(trans_icu('notifications.staff.invited.staff.action', $params), $this->url());
    }

    private function url(): string
    {
        return URL::temporarySignedRoute('staff.invitations.show', $this->invitation->expires_at, ['invitation' => $this->invitation->getKey()]);
    }

    /** @return array<string, string> */
    private function params(): array
    {
        $appName = (string) config('app.name');

        return [
            'appName' => $appName,
            'inviterName' => $this->invitation->invitedBy->name ?? $appName,
            'role' => trans_icu('roles.names.'.$this->invitation->role->value),
            // The invitee has no account, so no time zone of their own: the business's.
            'date' => $this->invitation->expires_at->setTimezone(app(Settings::class)->business()->timezone)->format(self::DATE_FORMAT),
        ];
    }
}
