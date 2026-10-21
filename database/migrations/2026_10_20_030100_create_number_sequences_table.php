<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('number_sequences', function (Blueprint $table): void {
            $table->string('key', 40)->primary();
            $table->bigInteger('last_value');
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('number_sequences');
    }
};
