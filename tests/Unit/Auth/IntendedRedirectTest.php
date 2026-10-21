<?php

declare(strict_types=1);

use App\Support\Auth\IntendedRedirect;
use Illuminate\Http\Request;

beforeEach(function (): void {
    config(['app.url' => 'https://furny.example.com']);
    $this->request = Request::create('https://furny.example.com/login');
});

it('accepts a relative path', function (string $path, string $expected): void {
    expect(IntendedRedirect::sameSitePath($this->request, $path))->toBe($expected);
})->with([
    'a path' => ['/projects', '/projects'],
    'the root' => ['/', '/'],
    'a query' => ['/projects?tab=open&page=2', '/projects?tab=open&page=2'],
    'a fragment is dropped' => ['/projects#top', '/projects'],
    'encoded characters stay encoded' => ['/a%5Cb/%2F%2Fevil.test', '/a%5Cb/%2F%2Fevil.test'],
]);

it('accepts an absolute URL of this site and gives its path', function (string $url, string $expected): void {
    expect(IntendedRedirect::sameSitePath($this->request, $url))->toBe($expected);
})->with([
    'the request origin' => ['https://furny.example.com/projects/1?x=2', '/projects/1?x=2'],
    'with the default port written out' => ['https://furny.example.com:443/projects', '/projects'],
    'host in capitals' => ['HTTPS://FURNY.EXAMPLE.COM/projects', '/projects'],
    'no path' => ['https://furny.example.com', '/'],
    'a double slash path stays on the site' => ['https://furny.example.com//evil.test/x', '/evil.test/x'],
]);

it('accepts the origin of app.url when the request came in another way', function (): void {
    $request = Request::create('http://10.0.0.5/login');

    expect(IntendedRedirect::sameSitePath($request, 'https://furny.example.com/projects'))->toBe('/projects')
        ->and(IntendedRedirect::sameSitePath($request, 'http://10.0.0.5/projects'))->toBe('/projects');
});

it('rejects everything that a browser could read as another site', function (?string $url): void {
    expect(IntendedRedirect::sameSitePath($this->request, $url))->toBeNull();
})->with([
    'nothing' => [null],
    'empty' => [''],
    'another host' => ['https://evil.test/x'],
    'our name inside another host' => ['https://furny.example.com.evil.test/x'],
    'our name as userinfo' => ['https://furny.example.com@evil.test/x'],
    'userinfo on our host' => ['https://user:pass@furny.example.com/x'],
    'another port' => ['https://furny.example.com:8443/x'],
    'plain http on our host' => ['http://furny.example.com/x'],
    'protocol-relative' => ['//evil.test/x'],
    'protocol-relative with our host' => ['//furny.example.com/x'],
    'a slash and a backslash' => ['/\\evil.test/x'],
    'backslashes after the scheme' => ['https:\\\\evil.test'],
    'a backslash in the path' => ['/a\\b'],
    'a tab' => ["/\t/evil.test"],
    'a newline' => ["/\n/evil.test"],
    'a carriage return' => ["/\r/evil.test"],
    'a NUL' => ["/\0/evil.test"],
    'a leading space' => [' /projects'],
    'a leading tab before the scheme' => ["\thttps://furny.example.com/x"],
    'javascript' => ['javascript:alert(1)'],
    'javascript in capitals' => ['JaVaScRiPt:alert(1)'],
    'javascript with our host in it' => ['javascript://furny.example.com/%0aalert(1)'],
    'data' => ['data:text/html,<script>alert(1)</script>'],
    'mailto' => ['mailto:a@b.test'],
    'ftp' => ['ftp://furny.example.com/x'],
    'a path without the leading slash' => ['projects'],
    'a host without a scheme' => ['evil.test/x'],
    'a long URL' => ['/'.str_repeat('a', 2050)],
]);
