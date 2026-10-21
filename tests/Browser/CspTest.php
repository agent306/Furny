<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

/**
 * The CSP of 13 §12.1 is enforced by a real browser here: a blocked script, style or connection is a console
 * error ("Refused to ..."), so a clean console means the nonce reached every script that has to run.
 */
it('loads public pages under the enforced CSP without console errors', function (string $path): void {
    visit($path)->assertNoJavaScriptErrors()->assertNoConsoleLogs();
})->with(['/', '/login', '/register', '/terms']);

it('blocks an inline script without the nonce and runs one with it', function (): void {
    Route::middleware('web')->get('/_inline-plain', fn () => response('<!doctype html><title>x</title><script>window.__ran = true</script>'));
    Route::middleware('web')->get('/_inline-nonced', fn () => response(
        '<!doctype html><title>x</title><script nonce="'.view()->shared('csp_nonce').'">window.__ran = true</script>',
    ));

    visit('/_inline-plain')->assertScript('window.__ran === undefined');
    visit('/_inline-nonced')->assertScript('window.__ran === true');
});
