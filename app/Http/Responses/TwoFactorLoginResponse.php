<?php

declare(strict_types=1);

namespace App\Http\Responses;

use App\Support\Auth\IntendedRedirect;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\TwoFactorLoginResponse as TwoFactorLoginResponseContract;
use Symfony\Component\HttpFoundation\Response;

/** After the two-factor challenge (13 §2): the same destination as a login without one. */
final class TwoFactorLoginResponse implements TwoFactorLoginResponseContract
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        return $request->wantsJson()
            ? new JsonResponse('', 204)
            : IntendedRedirect::response($request);
    }
}
