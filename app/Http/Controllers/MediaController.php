<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Identity\Models\User;
use App\Support\Media\Media;
use App\Support\Media\MediaAccess;
use App\Support\Uploads\FileName;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/** Private files (13 §8.9, §11.6): a policy check, then a redirect to a short-lived storage URL. The app never serves the bytes. */
final class MediaController extends Controller
{
    private const int URL_MINUTES = 15;

    public function show(Request $request, Media $media, MediaAccess $access): RedirectResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $access->authorize($user, $media);

        // A conversion that is not (yet) there is answered with the file itself.
        $requested = $request->string('conversion')->toString();
        $conversion = $media->hasGeneratedConversion($requested) ? $requested : '';

        // Anything but an image is forced to download, so it cannot run in a page of the storage origin.
        $headers = $conversion !== '' || str_starts_with($media->mime_type, 'image/') ? [] : [
            'ResponseContentDisposition' => 'attachment; filename="'.FileName::sanitize($media->name, pathinfo($media->file_name, PATHINFO_EXTENSION)).'"',
            'ResponseContentType' => $media->mime_type,
        ];

        return redirect()
            ->away($media->getTemporaryUrl(now()->addMinutes(self::URL_MINUTES), $conversion, $headers))
            ->header('Cache-Control', 'private, no-store');
    }
}
