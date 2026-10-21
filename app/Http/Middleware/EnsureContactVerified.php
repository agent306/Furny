<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Identity\Models\User;
use Closure;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/**
 * `verified.contact` (13 §1): a verified email or phone. Without one, machines get `403 {code: 'contact_unverified'}`
 * and everyone else is sent back with the error flash.
 */
final class EnsureContactVerified
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user instanceof User || $user->hasVerifiedContact()) {
            return $next($request);
        }

        if (! $request->header('X-Inertia') && $request->expectsJson()) {
            return response()->json(['code' => 'contact_unverified'], 403);
        }

        Inertia::flash('error', trans_icu('common.verify_required'));

        return redirect()->back();
    }
}
