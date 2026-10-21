<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Actions\ConfirmUploadIntent;
use App\Domain\Shared\Actions\CreateUploadIntent;
use App\Domain\Shared\Data\UploadIntentStatusData;
use App\Domain\Shared\Models\UploadIntent;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\PresignUploadRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/** Browser uploads through presigned PUTs (13 §11, 14 §4): presign, confirm, poll. */
final class UploadController extends Controller
{
    public function presign(PresignUploadRequest $request, CreateUploadIntent $create): JsonResponse
    {
        return response()->json($create->handle($this->user($request), $request->presignData()));
    }

    public function confirm(Request $request, UploadIntent $upload, ConfirmUploadIntent $confirm): JsonResponse
    {
        $user = $this->user($request);
        Gate::forUser($user)->authorize('confirm', $upload);

        $confirm->handle($user, $upload);

        return response()->json(['uploadId' => $upload->id, 'status' => 'processing'], 202);
    }

    public function show(Request $request, UploadIntent $upload): JsonResponse
    {
        Gate::forUser($this->user($request))->authorize('view', $upload);

        return response()->json(UploadIntentStatusData::fromIntent($upload));
    }

    private function user(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $user;
    }
}
