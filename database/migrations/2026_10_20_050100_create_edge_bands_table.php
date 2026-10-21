<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('edge_bands', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('code', 40)->unique();
            $table->string('name', 120);
            $table->decimal('thickness_mm', 4, 2);
            $table->integer('width_mm');
            $table->char('color_hex', 7)->nullable();
            $table->bigInteger('price_per_meter_minor')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->softDeletesTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('edge_bands');
    }
};
