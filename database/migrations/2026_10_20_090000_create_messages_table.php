<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            // Null for system messages; kept when the author's account is deleted.
            $table->foreignUlid('author_id')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->string('kind', 24)->default('text');
            $table->text('body');
            $table->string('system_event', 64)->nullable();
            $table->jsonb('system_payload')->nullable();
            $table->timestampTz('edited_at')->nullable();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['order_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
