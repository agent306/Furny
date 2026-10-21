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
        Schema::create('users', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('type', 16);
            $table->string('name', 120);
            $table->string('email', 254)->nullable();
            $table->timestampTz('email_verified_at')->nullable();
            $table->string('phone_e164', 20)->nullable();
            $table->timestampTz('phone_verified_at')->nullable();
            // When the user first had a verified email or phone (13 §5.6): `ContactVerified` fires once, when this
            // is set, and never again, however the contacts change afterwards.
            $table->timestampTz('first_contact_verified_at')->nullable();
            $table->string('password')->nullable();
            $table->string('google_id', 64)->nullable();
            $table->string('unit_system', 8)->default('metric');
            $table->string('length_unit', 4)->default('mm');
            $table->string('locale', 8)->default('en');
            $table->string('timezone', 64)->default('Asia/Kolkata');
            $table->boolean('is_active')->default(true);
            $table->timestampTz('last_login_at')->nullable();
            $table->text('two_factor_secret')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            $table->timestampTz('two_factor_confirmed_at')->nullable();
            $table->rememberToken();
            $table->boolean('marketing_opt_in')->default(false);
            $table->text('notes_internal')->nullable();
            $table->timestampTz('terms_accepted_at')->nullable();
            $table->timestampTz('onboarded_at')->nullable();
            $table->timestampTz('anonymised_at')->nullable();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index(['type', 'created_at']);
        });

        // Uniqueness holds across soft-deleted rows (a deleted account keeps its email until
        // anonymisation, 13 §9), and only for present values, so these are partial unique indexes.
        DB::statement('CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX users_phone_e164_unique ON users (phone_e164) WHERE phone_e164 IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX users_google_id_unique ON users (google_id) WHERE google_id IS NOT NULL');
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_email_or_phone_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
