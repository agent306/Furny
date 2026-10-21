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
        Schema::create('tax_rates', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('name', 60);
            $table->integer('rate_bps');
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
        });

        // 02 §6.6: exactly one default rate.
        DB::statement('CREATE UNIQUE INDEX tax_rates_is_default_unique ON tax_rates (is_default) WHERE is_default');
    }

    public function down(): void
    {
        Schema::dropIfExists('tax_rates');
    }
};
