<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Identity\Models\OtpCode;
use Illuminate\Console\Command;

/** Deletes verification codes 24 hours after they expired (13 §4.1, §16 rule 8). Scheduled daily at 03:00 (01 §7). */
final class OtpPrune extends Command
{
    protected $signature = 'otp:prune';

    protected $description = 'Delete OTP codes that expired more than 24 hours ago';

    public function handle(): int
    {
        $deleted = OtpCode::query()->where('expires_at', '<', now()->subDay())->delete();

        $this->info("Deleted {$deleted} expired OTP codes.");

        return self::SUCCESS;
    }
}
