<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blueprint_imports', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('plan_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUlid('user_id')->constrained()->restrictOnDelete();
            $table->string('status', 24)->default('uploaded');
            $table->string('mode', 16)->default('auto');
            $table->string('source_kind', 16)->nullable();
            $table->string('original_filename', 255);
            $table->string('mime_type', 100)->nullable();
            $table->bigInteger('file_size_bytes')->nullable();
            $table->smallInteger('page_count')->nullable();
            $table->smallInteger('selected_page')->default(1);
            $table->jsonb('hints')->default('{}');
            $table->string('ai_provider', 24)->nullable();
            $table->string('ai_model', 100)->nullable();
            $table->integer('credits_reserved')->default(0);
            $table->integer('credits_charged')->default(0);
            $table->jsonb('result_document')->nullable();
            $table->jsonb('result_meta')->nullable();
            $table->integer('review_version')->default(1);
            $table->string('error_code', 48)->nullable();
            $table->text('error_message')->nullable();
            $table->smallInteger('attempts')->default(0);
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();

            $table->index(['user_id', 'created_at']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blueprint_imports');
    }
};
