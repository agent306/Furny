<?php

declare(strict_types=1);

namespace App\Support\Http;

use App\Domain\Identity\Support\InvitationUnavailable;
use App\Http\Controllers\Auth\StaffInvitationController;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\InvalidSignatureException;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\Response;

/**
 * The link of a staff invitation with a wrong or an expired signature is not an Error page: it is `Auth/InvitationInvalid`
 * with the reason (13 §5.9 step 3, 14 §1.2). A signature that is right but has run out is `expired`, anything else
 * `invalid`. Other signed routes, and machine clients, keep the 403.
 */
final class InvalidInvitationLink
{
    public static function render(InvalidSignatureException $exception, Request $request): ?Response
    {
        if (! $request->routeIs('staff.invitations.*') || ErrorPage::wantsMachineResponse($request)) {
            return null;
        }

        $reason = URL::hasCorrectSignature($request) && ! URL::signatureHasNotExpired($request)
            ? InvitationUnavailable::EXPIRED
            : InvitationUnavailable::INVALID;

        return StaffInvitationController::invalid($reason)->toResponse($request);
    }
}
