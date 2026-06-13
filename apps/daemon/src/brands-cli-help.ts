// Help surface for `od brand`. Kept pure and separate from cli.ts so a test can
// assert the advertised subcommands without spawning the CLI or stubbing
// process.exit / console.log. Mirrors design-systems-cli-help.ts.

export const BRAND_USAGE = `Usage:
  od brand list [--json]               List extracted brands (id, name, domain, status).
  od brand create <url> [--json]       Extract a brand from a website URL. Streams 3-stage
                                       progress to stderr; prints the final brand to stdout.
                                       --prompt-file <path|-> reads the URL from a file or stdin.
  od brand get <id> [--json]           Print one brand's full detail (meta + brand + guide).
  od brand delete <id> [--json]        Remove a brand and its registered design system.

Output:
  Plain text by default; --json prints raw JSON for any subcommand.
  create streams "[brand] <stage>" progress lines to stderr while extracting,
  then prints the final "<id>\\t<name>" to stdout (or the brand JSON with --json).

Common options:
  --daemon-url <url>   Open Design daemon HTTP base.`;

// `help`, `--help`, and `-h` all route to the usage text above.
export function isBrandHelpArg(arg: string | undefined): boolean {
  return arg === 'help' || arg === '--help' || arg === '-h';
}
