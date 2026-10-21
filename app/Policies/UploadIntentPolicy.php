<?php

declare(strict_types=1);

namespace App\Policies;

use App\Domain\Identity\Models\User;
use App\Domain\Shared\Models\UploadIntent;
use Illuminate\Auth\Access\Response;

/** An upload intent belongs to the user who presigned it, whatever their role; anybody else is told it does not exist. */
final class UploadIntentPolicy
{
    public function view(User $user, UploadIntent $intent): Response
    {
        return $intent->user_id === $user->id ? Response::allow() : Response::denyAsNotFound();
    }

    public function confirm(User $user, UploadIntent $intent): Response
    {
        return $this->view($user, $intent);
    }
}
