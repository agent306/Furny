<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Settings\Settings;
use Inertia\Inertia;
use Inertia\Response;

/**
 * `legal.terms` and `legal.privacy` (10 §4.9, 14 §2). The bodies are translations
 * (`legal.{page}.body`, ICU with `{business}`) the owner edits; the page escapes everything it renders.
 */
final class LegalController extends Controller
{
    /** The date of the shipped wording, shown as "last updated" (ISO date). */
    public const string UPDATED_ON = '2026-10-20';

    public function __construct(private readonly Settings $settings) {}

    public function terms(): Response
    {
        return $this->page('Legal/Terms');
    }

    public function privacy(): Response
    {
        return $this->page('Legal/Privacy');
    }

    private function page(string $component): Response
    {
        return Inertia::render($component, [
            'businessName' => $this->settings->business()->name,
            'updatedOn' => self::UPDATED_ON,
        ]);
    }
}
