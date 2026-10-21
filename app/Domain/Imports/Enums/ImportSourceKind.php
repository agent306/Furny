<?php

declare(strict_types=1);

namespace App\Domain\Imports\Enums;

use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/** `blueprint_imports.source_kind` (02 §4.1, 06 §2.1): the detected input kind. */
#[TypeScript]
enum ImportSourceKind: string
{
    case Raster = 'raster';
    case PdfVector = 'pdf_vector';
    case PdfRaster = 'pdf_raster';
    case Dxf = 'dxf';
    case Heic = 'heic';
}
