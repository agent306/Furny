<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('labour_rates', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('key', 48)->unique();
            $table->string('name', 120);
            $table->string('unit', 16);
            $table->bigInteger('rate_minor')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('labour_rates');
    }
};
