<?php

declare(strict_types=1);

it('renders the welcome page without JS errors', fn () => visit('/')->assertNoJavaScriptErrors());
