<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;

/**
 * `csp.report` (13 §12.1): receives the browser's CSP violation reports. Anyone can post here, so the body
 * is never logged as sent: only a fixed set of fields survives, URLs lose their query string, user info and
 * fragment (they can carry reset tokens), every value is capped, and the whole entry is cut to 2 KB.
 */
final class CspReportController extends Controller
{
    private const int MAX_BODY_BYTES = 65_536;

    private const int MAX_LOG_BYTES = 2048;

    private const int MAX_VALUE_LENGTH = 300;

    /** Report fields worth keeping; `original-policy` is constant and `script-sample` can hold page content. */
    private const array FIELDS = [
        'document-uri', 'referrer', 'blocked-uri', 'source-file', 'violated-directive', 'effective-directive',
        'disposition', 'status-code', 'line-number', 'column-number',
    ];

    public function __invoke(Request $request): Response
    {
        $body = $request->getContent();

        Log::channel('security')->warning('csp.violation', ['report' => $this->summarise($body)]);

        return response()->noContent();
    }

    private function summarise(string $body): string
    {
        if (strlen($body) > self::MAX_BODY_BYTES) {
            return $this->unreadable('too_large', strlen($body));
        }

        $decoded = json_decode($body, true);
        $report = is_array($decoded) ? ($decoded['csp-report'] ?? null) : null;

        if (! is_array($report)) {
            return $this->unreadable('malformed', strlen($body));
        }

        $kept = [];

        foreach (self::FIELDS as $field) {
            $value = $report[$field] ?? null;

            if (is_int($value)) {
                $kept[$field] = $value;
            } elseif (is_string($value) && $value !== '') {
                $kept[$field] = $this->clean($value);
            }
        }

        return $this->cap(json_encode($kept, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{}');
    }

    /** `https://host/path`: query, fragment and credentials are dropped; `inline`, `eval` and the like pass through. */
    private function clean(string $value): string
    {
        $parts = parse_url($value);

        if (is_array($parts) && isset($parts['scheme'], $parts['host'])) {
            $value = $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '').($parts['path'] ?? '');
        } elseif (str_contains($value, '?') || str_contains($value, '#')) {
            $value = substr($value, 0, strcspn($value, '?#'));
        }

        return mb_substr($value, 0, self::MAX_VALUE_LENGTH);
    }

    private function unreadable(string $reason, int $bytes): string
    {
        return (string) json_encode(['unreadable' => $reason, 'bytes' => $bytes]);
    }

    /** Never more than 2 KB, whatever the fields add up to. */
    private function cap(string $json): string
    {
        return strlen($json) <= self::MAX_LOG_BYTES ? $json : mb_strcut($json, 0, self::MAX_LOG_BYTES);
    }
}
