<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Laravel\Fortify\Contracts\ProfileInformationUpdatedResponse;
use Symfony\Component\HttpFoundation\Response;

/** After the profile form (14 §3.1): back to the page with the toast `account.toasts.profile_updated`. */
final class ProfileUpdatedResponse implements ProfileInformationUpdatedResponse
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        if ($request->wantsJson()) {
            return new JsonResponse('', 200);
        }

        Inertia::flash('success', trans_icu('account.toasts.profile_updated'));

        return back();
    }
}
