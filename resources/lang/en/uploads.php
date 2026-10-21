<?php

declare(strict_types=1);

// Upload refusals (13 §11, 06 §2.1). The key is the machine code of the refusal: the `code` of a 422 and the
// `reasonCode` of a rejected upload.
return [
    'errors' => [
        'upload_type_not_allowed' => "This file type isn't accepted here.",
        'unsupported_type' => "This file type isn't supported. Please upload a JPG, PNG, WebP, HEIC, PDF or DXF.",
        'dwg_not_supported' => "DWG files can't be opened. In your CAD program use *Save as → DXF* or *Print → PDF*, then upload that file.",
        'file_too_large' => 'This file is empty or larger than the limit of {max}.',
        'upload_type_mismatch' => "This file isn't the type it claims to be.",
        'upload_image_too_large' => 'This image has too many pixels. Please use one of up to 40 megapixels and 12,000 pixels a side.',
        'upload_corrupt' => "We couldn't read this file. Please try another one.",
        'upload_size_mismatch' => "The upload didn't arrive in full. Please try again.",
        'upload_missing' => "The upload hasn't arrived yet. Please wait a moment and try again.",
        'upload_expired' => 'This upload took too long. Please start it again.',
        'upload_processing_failed' => "We couldn't process this file. Please try again.",
        'upload_invalid' => "This upload can't be used. Please upload the file again.",
        'invalid_target' => "This upload doesn't belong to anything we can find.",

        // Refusals the browser finds before the server is asked (15 §9.10) and failures on the way.
        'type' => "{name}: this file type isn't allowed.",
        'size' => '{name} is larger than {max}.',
        'count' => '{max, plural, one {You can attach one file.} other {You can attach up to # files.}}',
        'network' => "The upload didn't go through. Please check your connection and try again.",
        'timeout' => 'Checking the file took too long. Please try again.',
        'failed' => 'Something went wrong with this upload. Please try again.',
    ],

    'drop_here' => 'Drag files here or <browse>browse</browse>',
    'take_photo' => 'Take photo',
    'remove' => 'Remove {name}',
    'status' => [
        'preparing' => 'Preparing…',
        'uploading' => 'Uploading {percent}%',
        'checking' => 'Checking…',
        'ready' => 'Ready',
    ],

    'gallery' => [
        'more' => '{count, plural, one {# more photo} other {# more photos}}',
    ],

    'lightbox' => [
        'title' => 'Photo viewer',
        'carousel' => 'carousel',
        'counter' => '{index} / {count}',
        'announce' => 'Photo {index} of {count}',
        'previous' => 'Previous photo',
        'next' => 'Next photo',
        'download' => 'Download',
    ],

    'attachment' => [
        'download' => 'Download {name}',
    ],
];
