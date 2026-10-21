<?php

declare(strict_types=1);

it('answers the framework health route', fn () => $this->get('/up')->assertOk());
