<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Identity\Models\User;
use App\Support\Settings\Settings;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** `welcome` (10 §4.1, 14 §2): the public landing page; signed-in users go straight to their dashboard. */
final class WelcomeController extends Controller
{
    public function __invoke(Request $request, Settings $settings): Response|RedirectResponse
    {
        $user = $request->user();

        if ($user instanceof User) {
            return redirect()->route($user->isStaff() ? 'admin.dashboard' : 'customer.dashboard');
        }

        return Inertia::render('Welcome', [
            'canRegister' => $settings->auth()->allowCustomerRegistration,
        ]);
    }
}
