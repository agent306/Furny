<?php

declare(strict_types=1);

namespace App\Http\Responses;

use App\Support\Auth\IntendedRedirect;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;
use Symfony\Component\HttpFoundation\Response;

/** After registering (13 §5.1 step 4): the customer is signed in and goes to the dashboard (or the page they came for). */
final class RegisterResponse implements RegisterResponseContract
{
    /** @param  Request  $request */
    public function toResponse($request): Response
    {
        return $request->wantsJson()
            ? new JsonResponse('', 201)
            : IntendedRedirect::response($request);
    }
}
