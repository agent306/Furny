<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('upload_intents', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('purpose', 32);
            $table->string('target_type', 64)->nullable();
            $table->char('target_id', 26)->nullable();
            $table->string('object_key', 255);
            $table->string('processed_key', 255)->nullable();
            $table->string('original_filename', 255);
            $table->string('declared_mime', 100);
            $table->bigInteger('declared_size');
            $table->string('sniffed_mime', 100)->nullable();
            $table->integer('width')->nullable();
            $table->integer('height')->nullable();
            $table->string('status', 16)->default('pending');
            $table->string('reason_code', 48)->nullable();
            $table->timestampTz('expires_at');
            $table->timestampTz('consumed_at')->nullable();
            $table->timestampsTz();

            $table->index(['user_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('upload_intents');
    }
};
