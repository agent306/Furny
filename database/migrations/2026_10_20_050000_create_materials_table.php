<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('materials', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('code', 40)->unique();
            $table->string('name', 120);
            $table->string('board_type', 24);
            $table->decimal('thickness_mm', 5, 1);
            $table->integer('sheet_length_mm');
            $table->integer('sheet_width_mm');
            $table->boolean('has_grain')->default(false);
            $table->string('decor_name', 120)->nullable();
            $table->char('color_hex', 7)->nullable();
            $table->string('surface', 24)->default('melamine');
            $table->bigInteger('price_per_sheet_minor')->default(0);
            $table->decimal('waste_factor', 4, 3)->default('0.100');
            $table->integer('density_kg_m3')->nullable();
            $table->jsonb('usage')->default('["carcass","shelf","front","back","top"]');
            $table->string('default_edge_band_code', 40)->nullable();
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->timestampsTz();
            $table->softDeletesTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('materials');
    }
};
