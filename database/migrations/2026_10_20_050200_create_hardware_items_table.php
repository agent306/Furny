<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hardware_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('code', 40)->unique();
            $table->string('name', 160);
            $table->string('category', 24);
            $table->jsonb('specs');
            $table->string('unit', 16);
            $table->bigInteger('price_minor')->default(0);
            $table->jsonb('is_default_for')->default('[]');
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->timestampsTz();
            $table->softDeletesTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hardware_items');
    }
};
