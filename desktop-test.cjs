// Electron entry lives at the project root so the real bridge finds ./a11y.
require(process.argv.includes('--diagnose')
  ? './scripts/diagnose-click.cjs'
  : './scripts/windows-desktop-test.cjs');
