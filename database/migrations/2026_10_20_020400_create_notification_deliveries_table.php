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
        Schema::create('notification_deliveries', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->uuid('notification_id')->nullable();
            $table->foreignUlid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event_key', 64);
            $table->string('channel', 16);
            $table->string('driver', 16);
            $table->string('to_masked', 32);
            $table->char('to_hash', 64);
            $table->string('template_name', 128)->nullable();
            $table->string('provider_message_id', 128)->nullable();
            $table->string('status', 16)->default('pending');
            $table->string('error_code', 32)->nullable();
            $table->string('error_title', 255)->nullable();
            $table->string('pricing_category', 24)->nullable();
            $table->boolean('billable')->nullable();
            $table->char('fallback_of_id', 26)->nullable()->index();
            $table->jsonb('context')->nullable();
            $table->smallInteger('attempts')->default(0);
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('failed_at')->nullable();
            $table->timestampsTz();

            $table->index(['user_id', 'channel', 'created_at']);
            $table->index(['to_hash', 'channel', 'created_at']);
            $table->index(['event_key', 'created_at']);
            $table->index(['status', 'created_at']);
        });

        // Self-reference: added once the primary key exists.
        Schema::table('notification_deliveries', function (Blueprint $table): void {
            $table->foreign('fallback_of_id')->references('id')->on('notification_deliveries')->nullOnDelete();
        });

        // Providers repeat status webhooks; one row per provider message (12 §11).
        DB::statement('CREATE UNIQUE INDEX notification_deliveries_driver_provider_message_id_unique ON notification_deliveries (driver, provider_message_id) WHERE provider_message_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_deliveries');
    }
};
