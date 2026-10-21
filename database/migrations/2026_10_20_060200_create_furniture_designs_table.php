<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('furniture_designs', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('owner_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('name', 120);
            $table->string('template_key', 40);
            $table->foreignUlid('preset_id')->nullable()->constrained('furniture_presets')->nullOnDelete();
            $table->jsonb('working_document');
            $table->integer('working_version')->default(1);
            $table->foreignUlid('working_saved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('working_saved_at')->nullable();
            // The foreign key to furniture_revisions is added by 2026_10_20_060400 (circular reference).
            $table->ulid('current_revision_id')->nullable();
            // The foreign key to orders is added with the orders tables (02 §15 group 8).
            $table->ulid('locked_by_order_id')->nullable();
            $table->jsonb('estimate')->default('{}');
            $table->integer('width_mm');
            $table->integer('height_mm');
            $table->integer('depth_mm');
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['project_id', 'updated_at']);
            $table->index('locked_by_order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('furniture_designs');
    }
};
