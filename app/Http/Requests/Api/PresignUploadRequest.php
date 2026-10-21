<?php

declare(strict_types=1);

namespace App\Http\Requests\Api;

use App\Domain\Shared\Data\PresignTargetData;
use App\Domain\Shared\Data\PresignUploadData;
use App\Domain\Shared\Enums\UploadPurpose;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * `api.uploads.presign` (13 §11.2). Only the shape of the body is checked here; the sizes, types and the target are
 * `CreateUploadIntent`'s, which answers with the codes of 13 §11.
 */
final class PresignUploadRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'purpose' => ['required', 'string', Rule::enum(UploadPurpose::class)],
            'filename' => ['required', 'string', 'max:255'],
            // A size that is not a positive number is `file_too_large`, not a validation error.
            'size' => ['required', 'integer'],
            'contentType' => ['required', 'string', 'max:100'],
            'target' => ['nullable', 'array'],
            'target.type' => ['required_with:target', 'string', 'max:64'],
            'target.id' => ['required_with:target', 'string', 'max:26'],
        ];
    }

    public function presignData(): PresignUploadData
    {
        return new PresignUploadData(
            purpose: UploadPurpose::from($this->string('purpose')->toString()),
            filename: $this->string('filename')->toString(),
            size: $this->integer('size'),
            contentType: $this->string('contentType')->toString(),
            target: $this->filled('target.type') ? new PresignTargetData($this->string('target.type')->toString(), $this->string('target.id')->toString()) : null,
        );
    }
}
