<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('furniture_designs', function (Blueprint $table): void {
            $table->foreign('current_revision_id')->references('id')->on('furniture_revisions')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('furniture_designs', function (Blueprint $table): void {
            $table->dropForeign(['current_revision_id']);
        });
    }
};
