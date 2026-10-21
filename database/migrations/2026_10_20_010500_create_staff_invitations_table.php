<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_invitations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('email', 254);
            $table->string('name', 120);
            $table->string('role', 32);
            $table->foreignUlid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('expires_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestampsTz();

            $table->index('created_at');
        });

        // One open invitation per email; accepted and revoked rows are kept for audit (13 §5.9).
        DB::statement('CREATE UNIQUE INDEX staff_invitations_email_unique ON staff_invitations (email) WHERE accepted_at IS NULL AND revoked_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_invitations');
    }
};
