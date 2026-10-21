<?php

declare(strict_types=1);

namespace App\Http\Controllers\Customer\Account;

use App\Domain\Identity\Actions\ExportUserData;
use App\Domain\Identity\Models\User;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** `customer.account.export` (13 §9.3): the customer's data as a JSON download. */
final class DataExportController extends Controller
{
    public function __invoke(Request $request, ExportUserData $export): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 403);

        return $export->stream($user);
    }
}
