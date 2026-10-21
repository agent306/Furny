<?php

declare(strict_types=1);

namespace App\Domain\Shared\Actions;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Data\PresignUploadData;
use App\Domain\Shared\Enums\UploadPurpose;
use App\Domain\Shared\Enums\UploadStatus;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Http\CodedValidationException;
use App\Support\Uploads\FileName;
use App\Support\Uploads\MagicBytes;
use App\Support\Uploads\UploadPresigner;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Number;

/**
 * Presign (13 §11.2): authorise the target, validate the declared type and size, record a pending intent and return a
 * presigned PUT whose signature covers the type and the exact length.
 */
final class CreateUploadIntent
{
    /** How long the PUT may start. */
    private const int EXPIRES_MINUTES = 15;

    public function __construct(private readonly UploadPresigner $presigner) {}

    /**
     * @return array{uploadId: string, url: string, headers: array<string, string>}
     *
     * @throws AuthorizationException 403, or 404 where the policy hides the target
     * @throws ModelNotFoundException the target does not exist
     * @throws CodedValidationException `invalid_target`, `upload_type_not_allowed`, `unsupported_type`, `dwg_not_supported`, `file_too_large`
     */
    public function handle(User $user, PresignUploadData $data): array
    {
        $purpose = $data->purpose;
        $target = $this->target($purpose, $data);

        $purpose->authorizeTarget($user, $target);

        $contentType = strtolower(trim($data->contentType));
        $extension = strtolower(pathinfo($data->filename, PATHINFO_EXTENSION));

        $this->validate($purpose, $contentType, $extension, $data->size);

        $id = (new UploadIntent)->newUniqueId();
        $key = sprintf('tmp/%s/%s/%s', $purpose->value, now()->format('Y/m'), $id);
        $expiresAt = now()->addMinutes(self::EXPIRES_MINUTES);

        $presigned = $this->presigner->presignPut($key, $contentType, $data->size, $expiresAt);

        $intent = new UploadIntent([
            'user_id' => $user->id,
            'purpose' => $purpose,
            'target_type' => $target?->getMorphClass(),
            'target_id' => $target?->getKey(),
            'object_key' => $key,
            'original_filename' => FileName::sanitize($data->filename),
            'declared_mime' => $contentType,
            'declared_size' => $data->size,
            'status' => UploadStatus::Pending,
            'expires_at' => $expiresAt,
        ]);
        $intent->id = $id;
        $intent->save();

        return ['uploadId' => $id, 'url' => $presigned->url, 'headers' => $presigned->headers];
    }

    /**
     * The model the upload is authorised against: none for a purpose that has none (a target sent anyway is ignored);
     * otherwise the one named in the body, which must be of the purpose's kind. An id that exists nowhere is a 404.
     */
    private function target(UploadPurpose $purpose, PresignUploadData $data): ?Model
    {
        $type = $purpose->targetType();

        if ($type === null) {
            return null;
        }

        if ($data->target?->type !== $type) {
            throw CodedValidationException::make('invalid_target', trans_icu('uploads.errors.invalid_target'), 'target');
        }

        /** @var class-string<Model> $class */
        $class = Relation::getMorphedModel($type);

        return $class::query()->findOrFail($data->target->id);
    }

    private function validate(UploadPurpose $purpose, string $contentType, string $extension, int $size): void
    {
        if ($purpose === UploadPurpose::BlueprintSource) {
            // 06 §2.1: the extension decides first, for the DWG message and the size limit of DXF.
            if ($extension === 'dwg') {
                throw CodedValidationException::make('dwg_not_supported', trans_icu('uploads.errors.dwg_not_supported'), 'filename');
            }

            if (MagicBytes::typeOfExtension($extension) === null) {
                throw CodedValidationException::make('unsupported_type', trans_icu('uploads.errors.unsupported_type'), 'filename');
            }
        }

        if (! in_array($contentType, $purpose->allowedDeclaredMimes(), true)
            || (in_array($contentType, MagicBytes::GENERIC_MIMES, true) && ! MagicBytes::genericMimeFits($contentType, $extension))) {
            throw CodedValidationException::make('upload_type_not_allowed', trans_icu('uploads.errors.upload_type_not_allowed'), 'contentType');
        }

        $max = $purpose->maxBytes($extension);

        if ($size < 1 || $size > $max) {
            throw CodedValidationException::make('file_too_large', trans_icu('uploads.errors.file_too_large', ['max' => Number::fileSize($max, maxPrecision: 1)]), 'size');
        }
    }
}
