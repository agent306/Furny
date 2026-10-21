<?php

declare(strict_types=1);

use App\Support\Privacy\Mask;

it('masks an email address, keeping the first and last character of the local part', function (): void {
    expect(Mask::email('asha.k@example.com'))->toBe('a****k@e******.com');
});

it('masks short and unusual email addresses without leaking them', function (string $email, string $masked): void {
    expect(Mask::email($email))->toBe($masked);
})->with([
    'one-character local part' => ['a@example.com', '*@e******.com'],
    'two-character local part' => ['ab@example.com', 'a*@e******.com'],
    'subdomain keeps only the last label' => ['asha@mail.example.co.in', 'a**a@m'.str_repeat('*', 14).'.in'],
    'upper case is kept' => ['Asha.K@Example.COM', 'A****K@E******.COM'],
    'no at sign' => ['not-an-email', 'n***********'],
    'empty' => ['', ''],
]);

it('masks a phone number, keeping the country code and the last four digits', function (): void {
    expect(Mask::phone('+919876543210'))->toBe('+91******3210');
});

it('masks formatted and national phone numbers', function (string $phone, string $masked): void {
    expect(Mask::phone($phone))->toBe($masked);
})->with([
    'spaces' => ['+91 98765 43210', '+91******3210'],
    'us number' => ['+14155552671', '+1******2671'],
    'no country code' => ['9876543210', '******3210'],
    'too short to mask' => ['1234', '****'],
    'empty' => ['', ''],
]);

it('truncates an IP address to its network', function (string $ip, string $masked): void {
    expect(Mask::ip($ip))->toBe($masked);
})->with([
    'ipv4' => ['203.0.113.45', '203.0.113.0'],
    'ipv6 /48' => ['2001:db8:abcd:12::1', '2001:db8:abcd::'],
    'ipv6 full' => ['2001:0db8:abcd:0012:0000:0000:0000:0001', '2001:db8:abcd::'],
    'not an ip' => ['garbage', ''],
]);
