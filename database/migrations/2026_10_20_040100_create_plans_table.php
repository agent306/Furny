<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80)->default('Ground floor');
            $table->smallInteger('level_index')->default(0);
            $table->string('source', 16);
            $table->jsonb('working_document');
            $table->integer('working_version')->default(1);
            $table->foreignUlid('working_saved_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestampTz('working_saved_at')->nullable();
            // The foreign key to plan_revisions is added by 2026_10_20_040300 (circular reference).
            $table->ulid('current_revision_id')->nullable()->index();
            $table->smallInteger('schema_version')->default(1);
            $table->jsonb('summary')->default('{}');
            $table->timestampTz('locked_at')->nullable();
            $table->foreignUlid('locked_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['project_id', 'level_index']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
