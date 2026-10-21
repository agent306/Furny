<?php

declare(strict_types=1);

use App\Providers\AppServiceProvider;
use App\Providers\AuthServiceProvider;
use App\Providers\FortifyServiceProvider;
use App\Providers\HorizonServiceProvider;
use App\Providers\RateLimitServiceProvider;
use App\Providers\TypeScriptTransformerServiceProvider;

return [
    AppServiceProvider::class,
    AuthServiceProvider::class,
    FortifyServiceProvider::class,
    HorizonServiceProvider::class,
    RateLimitServiceProvider::class,
    TypeScriptTransformerServiceProvider::class,
];
