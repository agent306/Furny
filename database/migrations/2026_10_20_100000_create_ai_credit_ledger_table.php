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
        // Append only: balance = SUM(delta) per user (02 §7.1), so there is no updated_at.
        Schema::create('ai_credit_ledger', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->integer('delta');
            $table->string('kind', 24);
            $table->char('period', 7)->nullable();
            // Morph to the record the entry is about (a BlueprintImport); not a foreign key.
            $table->string('reference_type')->nullable();
            $table->char('reference_id', 26)->nullable();
            $table->string('note', 255)->nullable();
            $table->foreignUlid('created_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['user_id', 'created_at']);
            $table->index(['reference_type', 'reference_id']);
        });

        // One monthly grant per user and period (02 §7.1, 18 Q6): the daily top-up job is idempotent through it.
        DB::statement("create unique index ai_credit_ledger_one_monthly_grant_per_period on ai_credit_ledger (user_id, period) where kind = 'monthly_grant'");
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_credit_ledger');
    }
};
