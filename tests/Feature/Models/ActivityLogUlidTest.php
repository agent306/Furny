<?php

declare(strict_types=1);

use App\Domain\Identity\Models\User;
use Illuminate\Support\Facades\DB;

it('stores ULID subject and causer ids in the activity log under the morph alias', function (): void {
    $user = User::factory()->create();

    activity('security')->performedOn($user)->causedBy($user)->event('auth.login')->log('auth.login');

    $row = DB::table('activity_log')->first();

    expect($row->subject_id)->toBe($user->id)
        ->and($row->subject_id)->toHaveLength(26)
        ->and($row->causer_id)->toBe($user->id)
        ->and($row->subject_type)->toBe('user')
        ->and($row->causer_type)->toBe('user')
        ->and($row->log_name)->toBe('security')
        ->and($row->event)->toBe('auth.login');
});

it('resolves the subject and causer relations back to the user', function (): void {
    $user = User::factory()->create();

    $activity = activity('security')->performedOn($user)->causedBy($user)->event('auth.login')->log('auth.login');

    expect($activity->subject->is($user))->toBeTrue()
        ->and($activity->causer->is($user))->toBeTrue();
});

it('keeps the activity log for three years', function (): void {
    expect(config('activitylog.delete_records_older_than_days'))->toBe(1095)
        ->and(config('activitylog.clean_after_days'))->toBe(1095);
});
