<?php

use App\Http\Controllers\Api\OffenderJournalController;
use Illuminate\Support\Facades\Route;

Route::get('/journals/offenders', [OffenderJournalController::class, 'index'])
    ->name('journals.offenders');
