<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('finishes', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('code', 40)->unique();
            $table->string('name', 120);
            $table->string('finish_type', 24);
            $table->bigInteger('price_per_sqm_minor')->default(0);
            $table->jsonb('applies_to');
            $table->char('color_hex', 7)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->softDeletesTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('finishes');
    }
};
