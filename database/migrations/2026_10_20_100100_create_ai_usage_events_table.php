<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_usage_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('feature', 32);
            $table->string('provider', 24);
            $table->string('model', 100)->nullable();
            $table->integer('request_count');
            $table->integer('input_tokens')->default(0);
            $table->integer('output_tokens')->default(0);
            $table->integer('image_count')->default(0);
            // Estimated cost in millionths of USD, from the price table of the `ai` settings.
            $table->bigInteger('cost_micro_usd');
            $table->integer('duration_ms');
            $table->string('status', 16);
            // Morph to the BlueprintImport the run was for; null for `provider_test`. Not a foreign key.
            $table->string('reference_type')->nullable();
            $table->char('reference_id', 26)->nullable();
            $table->timestampTz('created_at');

            $table->index('created_at');
            $table->index(['user_id', 'created_at']);
            $table->index(['provider', 'created_at']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage_events');
    }
};
