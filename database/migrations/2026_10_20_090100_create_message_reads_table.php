<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_reads', function (Blueprint $table): void {
            $table->foreignUlid('order_id')->constrained()->cascadeOnDelete();
            // The primary key covers order_id; user_id gets its own index for the cascade and "my threads" lookups.
            $table->foreignUlid('user_id')->index()->constrained()->cascadeOnDelete();
            $table->timestampTz('last_read_at');
            // Not a foreign key: a read mark outlives a hard-deleted message.
            $table->char('last_read_message_id', 26)->nullable();

            $table->primary(['order_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_reads');
    }
};
