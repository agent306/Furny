<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Identity\Models\User;
use App\Support\Media\Media;
use App\Support\Media\MediaAccess;
use App\Support\Uploads\FileName;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/** Private files (13 §8.9, §11.6): a policy check, then a redirect to a short-lived storage URL. The app never serves the bytes. */
final class MediaController extends Controller
{
    private const int URL_MINUTES = 15;

    private const array CONVERSIONS = ['thumb', 'small', 'large', 'preview'];

    private const array INLINE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

    public function show(Request $request, Media $media, MediaAccess $access): RedirectResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $access->authorize($user, $media);

        // 14 §18: the names of the conversions; one the file does not have (or not yet) is answered with the file itself.
        $validator = Validator::make($request->query(), ['conversion' => ['nullable', 'string', 'in:'.implode(',', self::CONVERSIONS)]]);
        abort_if($validator->fails(), 422);

        $requested = $request->string('conversion')->toString();
        $conversion = $media->hasGeneratedConversion($requested) ? $requested : '';

        // Only the image types the app itself produces are shown in the browser; anything else (a DXF sniffed as
        // `image/vnd.dxf`, SVG, HEIC, PDF) is forced to download, so it cannot run in a page of the storage origin.
        $headers = $conversion !== '' || in_array($media->mime_type, self::INLINE_MIMES, true) ? [] : [
            'ResponseContentDisposition' => 'attachment; filename="'.FileName::sanitize($media->name, pathinfo($media->file_name, PATHINFO_EXTENSION)).'"',
            'ResponseContentType' => $media->mime_type,
        ];

        return redirect()
            ->away($media->getTemporaryUrl(now()->addMinutes(self::URL_MINUTES), $conversion, $headers))
            ->header('Cache-Control', 'private, no-store');
    }
}
