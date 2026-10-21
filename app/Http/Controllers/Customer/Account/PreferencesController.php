<?php

declare(strict_types=1);

namespace App\Http\Controllers\Customer\Account;

use App\Domain\Identity\Actions\UpdateDisplayPreferences;
use App\Domain\Identity\Data\AccountPreferencesProps;
use App\Domain\Identity\Enums\LengthUnit;
use App\Domain\Identity\Enums\UnitSystem;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Http\Requests\Account\UpdateDisplayPreferencesRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** `customer.account.preferences` and its update (10 §13.4). */
final class PreferencesController extends Controller
{
    public function show(Request $request): Response
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return Inertia::render('Customer/Account/Preferences', AccountPreferencesProps::fromUser($user)->toArray());
    }

    public function update(UpdateDisplayPreferencesRequest $request, UpdateDisplayPreferences $update): RedirectResponse
    {
        $update->handle(
            $request->userOrFail(),
            $request->enum('unitSystem', UnitSystem::class) ?? abort(422),
            $request->enum('lengthUnit', LengthUnit::class) ?? abort(422),
            $request->string('timezone')->toString(),
        );

        Inertia::flash('success', trans_icu('account.toasts.preferences_saved'));

        return back();
    }
}
