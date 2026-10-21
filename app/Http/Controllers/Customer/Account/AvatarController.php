<?php

declare(strict_types=1);

namespace App\Http\Controllers\Customer\Account;

use App\Domain\Identity\Actions\UpdateAvatar;
use App\Http\Controllers\Controller;
use App\Http\Requests\Account\UpdateAvatarRequest;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;

/** `customer.account.avatar.update` (10 §13.2): the photo from a ready upload, or none. */
final class AvatarController extends Controller
{
    public function update(UpdateAvatarRequest $request, UpdateAvatar $update): RedirectResponse
    {
        $update->handle($request->userOrFail(), $request->uploadId());

        Inertia::flash('success', trans_icu($request->uploadId() === null ? 'account.toasts.avatar_removed' : 'account.toasts.avatar_updated'));

        return back();
    }
}
