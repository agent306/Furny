<?php

declare(strict_types=1);

use App\Domain\Identity\Models\StaffInvitation;
use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\URL;
use Pest\Browser\ServerManager;

/** The staff page and the pages of an invitation (11 §7, §7.1): usable from 375 px up, one h1, accessible. */
const STAFF_NO_HORIZONTAL_SCROLL = 'document.documentElement.scrollWidth <= window.innerWidth';

/** A signed link for the origin the browser really talks to (the signature covers the host). */
function invitationLink(StaffInvitation $invitation): string
{
    URL::forceRootUrl(rtrim(ServerManager::instance()->http()->rewrite('/'), '/'));

    return URL::temporarySignedRoute('staff.invitations.show', $invitation->expires_at, ['invitation' => $invitation->id]);
}

dataset('staff pages', [
    'staff page' => [function (): string {
        test()->actingAs($admin = User::factory()->admin()->create(['name' => 'Ada Admin']));
        User::factory()->estimator()->create(['name' => 'Eli Estimator']);
        User::factory()->support()->inactive()->create(['name' => 'Gus Gone']);
        StaffInvitation::factory()->create(['email' => 'pat@example.com', 'name' => 'Pat Pending', 'invited_by' => $admin->id]);
        StaffInvitation::factory()->expired()->create(['email' => 'old@example.com', 'name' => 'Olly Old']);

        return '/admin/staff';
    }],
    'accept page' => [fn (): string => invitationLink(StaffInvitation::factory()->create(['email' => 'nina@example.com', 'name' => 'Nina Hire']))],
    'expired link' => [fn (): string => invitationLink(StaffInvitation::factory()->expired()->create())],
    'revoked invitation' => [fn (): string => invitationLink(StaffInvitation::factory()->revoked()->create())],
    'tampered link' => [fn (): string => invitationLink(StaffInvitation::factory()->create()).'x'],
]);

it('shows each page with one h1, no horizontal scroll and no JavaScript errors', function (Closure $path, int $width): void {
    visit($path())
        ->resize($width, 800)
        ->assertScript('document.querySelectorAll("h1").length', 1)
        ->assertScript(STAFF_NO_HORIZONTAL_SCROLL)
        ->assertNoJavaScriptErrors();
})->with('staff pages')->with([375, 820, 1280]);

it('has no serious accessibility violations', function (Closure $path): void {
    visit($path())->assertNoAccessibilityIssues(1);
})->with('staff pages');
