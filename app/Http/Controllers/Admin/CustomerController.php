<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Domain\Identity\Actions\AnonymiseUser;
use App\Domain\Identity\Actions\RestoreDeletedAccount;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Customers\AnonymiseCustomerRequest;
use App\Http\Requests\Admin\Customers\RestoreCustomerRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

/**
 * The lifecycle actions of a customer account (13 §9): restore a deletion within its 30 days, and anonymise at once.
 * The list, detail and edit actions arrive with the customer pages (P5).
 */
final class CustomerController extends Controller
{
    /** `$user` is the bound `{user}`, deleted accounts included; the request has checked it is a deleted customer. */
    public function restore(RestoreCustomerRequest $request, User $user, RestoreDeletedAccount $restore): RedirectResponse
    {
        $restore->handle($user, $request->actor());

        Inertia::flash('success', trans_icu('customers.toasts.restored'));

        return back();
    }

    public function anonymise(AnonymiseCustomerRequest $request, User $user, AnonymiseUser $anonymise): RedirectResponse
    {
        $anonymise->handle($user, AnonymiseUser::VIA_ADMIN, $request->actor());

        Inertia::flash('success', trans_icu('customers.toasts.anonymised'));

        // The customer list (14 §9) is built in P5; the dashboard is where staff land until then.
        return redirect()->route(Route::has('admin.customers.index') ? 'admin.customers.index' : 'admin.dashboard');
    }
}
