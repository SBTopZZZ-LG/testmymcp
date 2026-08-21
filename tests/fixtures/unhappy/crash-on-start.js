// Unhappy fixture: exits with a non-zero code immediately on startup.
process.stdout.write('about to crash on startup\n');
process.exit(3);
