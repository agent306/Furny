<?php

declare(strict_types=1);

namespace App\Http\Responses;

use App\Support\Auth\IntendedRedirect;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Symfony\Component\HttpFoundation\Response;

/** After a password login (13 §2): the intended page of this site, else the dashboard of the user's kind. */
final class LoginResponse implements LoginResponseContract
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        return $request->wantsJson()
            ? new JsonResponse(['two_factor' => false])
            : IntendedRedirect::response($request);
    }
}
