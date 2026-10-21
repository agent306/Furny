<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Ai\Models\AiCreditLedgerEntry;
use App\Domain\Furniture\Models\FurnitureDesign;
use App\Domain\Identity\Models\Address;
use App\Domain\Identity\Models\NotificationDelivery;
use App\Domain\Identity\Models\NotificationPreference;
use App\Domain\Identity\Models\OtpCode;
use App\Domain\Identity\Models\User;
use App\Domain\Imports\Models\BlueprintImport;
use App\Domain\Messaging\Models\Message;
use App\Domain\Orders\Models\ConfirmationCall;
use App\Domain\Orders\Models\Order;
use App\Domain\Orders\Models\Quote;
use App\Domain\Orders\States\Accepted;
use App\Domain\Projects\Models\Plan;
use App\Domain\Projects\Models\Project;
use App\Domain\Shared\Models\UploadIntent;
use App\Support\Media\Media;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A customer with a trace in every place `AnonymiseUser` (13 §9.2) and `ExportUserData` (13 §9.3) look at: an avatar, two
 * addresses (one an order points at), a project nobody ordered from and one with an order, each with a plan, an import and
 * a design, notifications, preferences, a phone code, a push subscription, a delivery, an upload, a password reset token, a
 * confirmation call and an accepted quote. The order is accepted (an Active state).
 *
 * The caller fakes the disks (`s3`, `s3-public`).
 */
final class AccountDataFixture
{
    public const string PHONE = '+919876543210';

    public const string IP = '203.0.113.45';

    public function __construct(
        public readonly User $user,
        public readonly Address $unusedAddress,
        public readonly Address $orderAddress,
        public readonly Project $goneProject,
        public readonly Plan $gonePlan,
        public readonly Project $keptProject,
        public readonly Plan $keptPlan,
        public readonly BlueprintImport $goneImport,
        public readonly BlueprintImport $keptImport,
        public readonly FurnitureDesign $keptDesign,
        public readonly Order $order,
        public readonly Message $message,
        public readonly ConfirmationCall $call,
        public readonly Quote $quote,
        public readonly UploadIntent $upload,
        public readonly string $notificationId,
    ) {}

    /** @param  int|null  $deletedDaysAgo  null leaves the account active */
    public static function create(?int $deletedDaysAgo = 31): self
    {
        $user = User::factory()->withPhone(self::PHONE)->googleLinked()->withTwoFactor()->create([
            'name' => 'Asha Krishnan',
            'email' => 'asha.krishnan@example.com',
            'notes_internal' => 'Prefers calls after 6 pm.',
            'last_login_at' => now()->subDay(),
            'marketing_opt_in' => true,
            'remember_token' => Str::random(60),
            'deleted_at' => $deletedDaysAgo === null ? null : now()->subDays($deletedDaysAgo),
        ]);

        $user->addMedia(base_path('tests/fixtures/uploads/plain.png'))->preservingOriginal()->toMediaCollection('avatar');

        $unused = Address::factory()->forUser($user)->create(['label' => 'Home', 'line1' => '12 MG Road', 'line2' => 'Flat 4']);
        $used = Address::factory()->forUser($user)->create([
            'label' => 'Site', 'line1' => '7 Lake View', 'line2' => 'Block B', 'city' => 'Bengaluru', 'region' => 'Karnataka',
            'postal_code' => '560001', 'country_code' => 'IN', 'latitude' => 12.9716, 'longitude' => 77.5946,
        ]);

        $goneProject = Project::factory()->forCustomer($user)->create(['name' => 'Old flat', 'notes' => 'Sketched from memory']);
        $gonePlan = Plan::factory()->state(['project_id' => $goneProject->id])->withThumbnail()->create();
        $goneImport = BlueprintImport::factory()->state(['project_id' => $goneProject->id])->create(['original_filename' => 'asha-floorplan.png']);
        FurnitureDesign::factory()->state(['project_id' => $goneProject->id])->withThumbnail()->create();

        $keptProject = Project::factory()->forCustomer($user)->create(['name' => 'Whitefield villa', 'notes' => 'Gate code 4411']);
        $keptPlan = Plan::factory()->state(['project_id' => $keptProject->id])->withThumbnail()->create();
        $keptImport = BlueprintImport::factory()->state(['project_id' => $keptProject->id])->create(['original_filename' => 'villa-scan.pdf']);
        $keptDesign = FurnitureDesign::factory()->state(['project_id' => $keptProject->id])->create(['name' => 'Master wardrobe']);

        $order = Order::factory()->state(['project_id' => $keptProject->id, 'site_address_id' => $used->id])->inState(Accepted::class)->create();
        $message = Message::factory()->create(['order_id' => $order->id, 'body' => 'Please use the service lift.']);
        $call = ConfirmationCall::factory()->create(['order_id' => $order->id, 'phone_e164' => self::PHONE]);
        $quote = Quote::factory()->accepted()->create(['order_id' => $order->id, 'accepted_by_ip' => self::IP]);

        AiCreditLedgerEntry::factory()->create(['user_id' => $user->id]);
        NotificationPreference::factory()->create(['user_id' => $user->id]);
        OtpCode::factory()->forPhone(self::PHONE)->create();
        NotificationDelivery::factory()->create(['user_id' => $user->id]);
        $user->updatePushSubscription('https://push.example/endpoint-asha', 'key', 'token', 'aesgcm');
        $upload = UploadIntent::factory()->for($user)->create(['original_filename' => 'asha-living-room.png']);

        $notificationId = (string) Str::uuid();
        DB::table('notifications')->insert([
            'id' => $notificationId,
            'type' => 'account.welcome',
            'notifiable_type' => 'user',
            'notifiable_id' => $user->id,
            'data' => '{}',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('password_reset_tokens')->insert(['email' => 'asha.krishnan@example.com', 'token' => 'hashed-token', 'created_at' => now()]);

        return new self($user, $unused, $used, $goneProject, $gonePlan, $keptProject, $keptPlan, $goneImport, $keptImport, $keptDesign, $order, $message, $call, $quote, $upload, $notificationId);
    }

    /** Whether any media row still belongs to the model. */
    public static function hasMedia(string $morphAlias, string $id): bool
    {
        return Media::query()->where('model_type', $morphAlias)->where('model_id', $id)->exists();
    }
}
