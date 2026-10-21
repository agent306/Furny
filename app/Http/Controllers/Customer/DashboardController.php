<?php

declare(strict_types=1);

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use Inertia\Inertia;
use Inertia\Response;

/** `customer.dashboard` (10 §6). A placeholder until the dashboard data exists (P5/P7). */
final class DashboardController extends Controller
{
    public function __invoke(): Response
    {
        return Inertia::render('Customer/Dashboard');
    }
}
