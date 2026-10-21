<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('furniture_template_settings', function (Blueprint $table): void {
            $table->string('template_key', 40)->primary();
            $table->boolean('is_enabled')->default(true);
            $table->integer('sort_order')->default(0);
            $table->jsonb('default_overrides')->default('{}');
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('furniture_template_settings');
    }
};
