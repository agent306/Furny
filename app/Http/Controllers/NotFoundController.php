<?php

declare(strict_types=1);

namespace App\Http\Controllers;

/** The target of the fallback routes: a 404 raised inside the `web` group, rendered by the Error page (10 §4.10). */
final class NotFoundController extends Controller
{
    public function __invoke(): never
    {
        abort(404);
    }
}
