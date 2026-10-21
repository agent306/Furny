<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('change_proposal_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('change_proposal_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('order_item_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('from_revision_id')->constrained('furniture_revisions')->restrictOnDelete();
            $table->foreignUlid('to_revision_id')->nullable()->constrained('furniture_revisions')->restrictOnDelete();
            $table->jsonb('staff_draft_document')->nullable();
            $table->integer('staff_draft_version')->default(1);
            $table->jsonb('changes')->nullable();
            $table->text('staff_note')->nullable();
            $table->string('decision', 16)->default('pending');
            $table->text('customer_comment')->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->timestampsTz();

            $table->unique(['change_proposal_id', 'order_item_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('change_proposal_items');
    }
};
