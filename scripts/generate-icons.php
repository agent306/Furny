<?php

declare(strict_types=1);

/**
 * Draws the default PWA / notification icon set into public/icons (10 §15, 12 §8.3).
 *
 * A walnut (#6b4a33) rounded square with a white "house + panel" glyph. Run once and commit the
 * output; owners replace the files in place (there is no admin UI in v1):
 *
 *     php scripts/generate-icons.php
 *
 * Every shape is drawn at 4x and averaged down, so the edges are antialiased.
 */
if (! extension_loaded('gd')) {
    fwrite(STDERR, "The GD extension is required.\n");
    exit(1);
}

const WALNUT = [0x6B, 0x4A, 0x33];
const WHITE = [0xFF, 0xFF, 0xFF];
const SUPERSAMPLE = 4;

/**
 * @param  array{0: int, 1: int, 2: int}  $rgb
 */
function colour(GdImage $image, array $rgb, int $alpha = 0): int
{
    $colour = imagecolorallocatealpha($image, $rgb[0], $rgb[1], $rgb[2], $alpha);

    if ($colour === false) {
        throw new RuntimeException('Could not allocate a colour.');
    }

    return $colour;
}

function roundedSquare(GdImage $image, int $size, float $radiusRatio, int $colour): void
{
    $radius = (int) round($size * $radiusRatio);
    $diameter = $radius * 2;

    imagefilledrectangle($image, $radius, 0, $size - $radius - 1, $size - 1, $colour);
    imagefilledrectangle($image, 0, $radius, $size - 1, $size - $radius - 1, $colour);

    foreach ([[$radius, $radius], [$size - $radius - 1, $radius], [$radius, $size - $radius - 1], [$size - $radius - 1, $size - $radius - 1]] as [$x, $y]) {
        imagefilledellipse($image, $x, $y, $diameter, $diameter, $colour);
    }
}

/**
 * The glyph in a unit square: a house silhouette with a tall panel (door / wardrobe leaf) cut out of it.
 *
 * @param  float  $scale  glyph size relative to the icon (maskable icons keep it inside the 80 % safe zone)
 * @param  array{0: int, 1: int, 2: int}  $ink
 */
function glyph(GdImage $image, int $size, float $scale, int $ink, int $cutout): void
{
    $at = static fn (float $unit): int => (int) round($size * (0.5 + ($unit - 0.5) * $scale));

    $roof = [$at(0.5), $at(0.14), $at(0.92), $at(0.52), $at(0.08), $at(0.52)];
    imagefilledpolygon($image, $roof, $ink);
    imagefilledrectangle($image, $at(0.18), $at(0.5), $at(0.82), $at(0.88), $ink);

    // The panel: a tall rounded leaf in the middle of the house, with a shelf line across it.
    $left = $at(0.41);
    $right = $at(0.59);
    $top = $at(0.56);
    $bottom = $at(0.88);
    $corner = max(1, (int) round(($right - $left) * 0.18));

    imagefilledrectangle($image, $left + $corner, $top, $right - $corner, $bottom, $cutout);
    imagefilledrectangle($image, $left, $top + $corner, $right, $bottom, $cutout);
    imagefilledellipse($image, $left + $corner, $top + $corner, $corner * 2, $corner * 2, $cutout);
    imagefilledellipse($image, $right - $corner, $top + $corner, $corner * 2, $corner * 2, $cutout);
}

/**
 * @param  string  $shape  'rounded' (transparent corners), 'full' (full-bleed square) or 'badge' (white glyph, transparent)
 */
function icon(int $size, string $shape, float $glyphScale): GdImage
{
    $big = $size * SUPERSAMPLE;
    $canvas = imagecreatetruecolor($big, $big);

    if ($canvas === false) {
        throw new RuntimeException('Could not create the canvas.');
    }

    imagealphablending($canvas, false);
    imagesavealpha($canvas, true);
    imagefill($canvas, 0, 0, colour($canvas, WALNUT, 127));

    $walnut = colour($canvas, WALNUT);
    $white = colour($canvas, WHITE);

    if ($shape === 'badge') {
        // Monochrome mask: the glyph is white, the panel is cut through to transparency.
        glyph($canvas, $big, $glyphScale, $white, colour($canvas, WALNUT, 127));
    } else {
        $shape === 'rounded' ? roundedSquare($canvas, $big, 0.225, $walnut) : imagefilledrectangle($canvas, 0, 0, $big - 1, $big - 1, $walnut);
        glyph($canvas, $big, $glyphScale, $white, $walnut);
    }

    $small = imagecreatetruecolor($size, $size);

    if ($small === false) {
        throw new RuntimeException('Could not create the canvas.');
    }

    imagealphablending($small, false);
    imagesavealpha($small, true);
    imagefill($small, 0, 0, colour($small, WALNUT, 127));
    imagecopyresampled($small, $canvas, 0, 0, 0, 0, $size, $size, $big, $big);

    return $small;
}

$directory = dirname(__DIR__).'/public/icons';

if (! is_dir($directory) && ! mkdir($directory, 0775, true)) {
    fwrite(STDERR, "Could not create {$directory}.\n");
    exit(1);
}

$icons = [
    'app-192.png' => [192, 'rounded', 0.78],
    'app-512.png' => [512, 'rounded', 0.78],
    // Maskable: full bleed, glyph inside the central 80 % circle (the platform crops the rest).
    'app-maskable-512.png' => [512, 'full', 0.56],
    // iOS rounds the corners itself and paints transparent pixels black.
    'apple-touch-icon-180.png' => [180, 'full', 0.7],
    'notification-192.png' => [192, 'rounded', 0.78],
    'badge-72.png' => [72, 'badge', 0.9],
];

foreach ($icons as $file => [$size, $shape, $scale]) {
    $image = icon($size, $shape, $scale);

    if (! imagepng($image, "{$directory}/{$file}", 9)) {
        fwrite(STDERR, "Could not write {$file}.\n");
        exit(1);
    }

    echo "public/icons/{$file} ({$size}x{$size})\n";
}
