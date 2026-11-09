# Prism

A Windows desktop workspace for Azure DevOps pull requests and GitHub Copilot reviews.

## Install

Build or use the generated installer at [release/Prism-Setup-0.1.0-x64.exe](release/Prism-Setup-0.1.0-x64.exe). It installs per user and does not require Node.js, Git, or a separate Copilot CLI on the destination machine. Electron and the Copilot runtime are included. The default local-account authentication requires Azure CLI installed separately and available on PATH; PAT and registered-app authentication do not require Azure CLI.

The initial distribution targets Windows 10/11 x64. Native ARM64, older Windows versions, and a clean-machine installation have not been tested. The installer is currently unsigned; Windows or organizational policy may warn or block installation. Production distribution needs an appropriate signing certificate and your organization's approval.

## First Use

1. Select **Add Source** and enter an ADO project URL to include its repositories, or a repository URL to include just that repo. Both `dev.azure.com/organization/project` and `organization.visualstudio.com/DefaultCollection/project` are supported.
2. Keep **Azure CLI (local account)** selected and connect. Prism reuses your existing `az login` session without a Prism app registration or PAT. If not signed in, run `az login --use-device-code` in a terminal first, using the account and tenant that have access to the ADO organization. Alternatively choose **Personal access token**: Code Read is sufficient for browsing; posting requires Code Read & Write and the relevant repository permissions. Reconnect the same source to change its authentication method or PAT.
3. Open **Settings**, sign in to GitHub Copilot, and authorize your Microsoft GitHub Enterprise Managed User identity, for example `alias_microsoft`. Set **Expected EMU login** to that exact login and save settings. A review is blocked if the active account differs.
4. Add one or more review-instruction folders. Prism loads Markdown and text files recursively, rereads them for every review, and groups changed files according to YAML `applyTo` globs. Global files without `applyTo` apply to all changed files. Symbolic links and dependency/build directories are skipped.
5. Select a PR, inspect Changes or Overview, and select **Run Review**. Findings are local drafts. Select a finding to jump to its line, edit its title/body/location/severity, or dismiss it. The line's plus button adds a manual finding without requiring a Copilot review.
6. Select **Post to PR**, inspect the native confirmation dialog, and confirm the individual comment. A Copilot attribution is included. No review or sample action posts automatically.

**Open Sample** opens a clearly labelled, local sample workspace. Its posting and review controls are disabled. Sample edits do not affect saved reviews or ADO.

## Authentication Boundaries

ADO authentication and GitHub Copilot authentication are separate. A Microsoft Entra bearer token for ADO is not a Copilot token, and Prism does not read VS Code's private credential store. Copilot uses the official SDK's stored signed-in-user credentials and device-code flow. Use your Microsoft EMU GitHub account and complete any required enterprise SSO. A Copilot entitlement and organization policy permitting this runtime are required. VS Code access alone does not establish that the Copilot CLI/SDK is permitted.

Prism removes ambient `GH_TOKEN`, `GITHUB_TOKEN`, and related Copilot token overrides from its runtime environment, and checks the signed-in login before each review. Existing Copilot runtime credentials may be reused. Interactive device sign-in is implemented but has not been exercised end to end in this development session; existing signed-in-user status was verified in development and packaged builds.

### Local Azure CLI (Default)

No app registration or PAT is required. Install a recent Azure CLI that returns the `expires_on` field (2.54.0 or later), make `az` available on PATH, and sign in using the account and tenant that have access to ADO:

```powershell
az login --use-device-code
```

For a specific tenant, use `az login --tenant <tenant-id> --use-device-code`. If the account has no Azure subscriptions, add `--allow-no-subscriptions`. No Azure subscription is required by Prism itself.

Prism requests an Entra token for the Azure DevOps resource through `az account get-access-token` and calls ADO REST APIs with that bearer token. It does not read Azure CLI's credential files, borrow client IDs, or return tokens to the renderer. CLI tokens stay in main-process memory, are refreshed before expiry, and are not written into Prism's credential store. Concurrent ADO requests share token acquisition. Azure CLI owns its own sign-in/cache security. Restart Prism after changing the active CLI account or tenant to clear its in-memory token cache.

Missing/expired CLI sign-in and tenant-policy failures produce an error; Prism does not automatically start an interactive login or silently switch methods. Azure CLI is an optional dependency used only by sources configured for this method. Existing PAT and registered-app sources retain their saved method; reconnect a source with Azure CLI selected to switch it.

### Optional App Registration

For organizations that prefer their own registration, select **Microsoft account (app registration)** and configure **Advanced Microsoft sign-in (app registration)** in Settings. This uses MSAL's browser authorization code flow with PKCE and state validation, with explicit device-code fallback. MSAL owns the temporary localhost listener; tokens use the Windows-encrypted MSAL cache. This optional method is separate from the default CLI flow and from Copilot authentication.

Entra setup requires your own approved registration, not a client secret:

1. Register Prism in your organization's Microsoft Entra tenant, following its app approval policies.
2. Under **Authentication**, add the **Mobile and desktop applications** platform and register `http://localhost` as a redirect URI. MSAL chooses the loopback port dynamically; do not register this as a web application requiring a secret.
3. Add Azure DevOps delegated `user_impersonation` permission and obtain any required administrator consent. The user's existing ADO permissions still apply.
4. Enter the registration's application/client ID and tenant ID or domain in Prism's **Settings**, then select **Sign In with Microsoft**.
5. To use the explicit **Use Device Code** fallback, also enable public-client device-code flows in the registration. Browser failures are not silently retried with another authentication method.

Prism deliberately does not impersonate a Microsoft first-party client ID. PAT mode remains available and needs no app registration. Fresh browser/device sign-in and tenant-specific consent policies require acceptance testing with an approved registration.

## Review Safety and Coverage

- Reviews use the PR's latest iteration, exact source commit, and merge base. Findings retain that context. Changed source/target commits or iteration block posting until a new review is run.
- Copilot receives supplied changed-file text, metadata, and matching instructions only. It has no exposed tools and all permission requests are denied. PR content is treated as untrusted data, not review instructions. This is not a local repository agent or a full-repository semantic analysis.
- Each run includes at most 80 changed text files, each at most 300 KB and 8,000 lines. Files over 120,000 serialized characters are excluded from model review. Batches with different applicable instructions are isolated. Omitted, binary, inaccessible, or oversized files produce coverage warnings in Overview.
- Instruction input is limited to 100 files, 160 KB, and 12 nested directories. Exceeding a limit or invalid frontmatter fails explicitly rather than silently discarding rules.
- Model output is schema-validated. Finding file, side, and line must exist in the current review batch. Valid location does not establish that the finding is correct; human review is still required.
- Every post is explicit and includes iteration and rename-tracking metadata. If a POST result is uncertain, Prism persists that state and checks for its unique marker before any reconciliation. It will not blindly repeat an uncertain POST. Verify the thread in ADO before taking further action.
- Pending findings, settings, and fetched source are stored locally in Electron's per-user app-data directory. Only credentials are encrypted; source snapshots and review drafts are plaintext. The Copilot runtime may also retain its own session transcripts in its profile. Treat this machine and those directories as sensitive. Reviewing sends selected source and instructions to GitHub Copilot under your account and enterprise policies.

## Shortcuts

| Action | Key |
| --- | --- |
| Command palette | Ctrl+K |
| Search PRs | / |
| Next / previous PR | J / K |
| Next / previous file | Alt+Right / Alt+Left |
| Refresh inbox | Ctrl+R |
| Run review | Ctrl+Shift+R |
| Settings | Ctrl+, |
| Shortcut list | ? |
| Close dialog | Escape |

## Development

Use a supported Node.js LTS version meeting Electron Vite's Node requirement (22.12+ or 24 LTS recommended) and npm. The installed lockfile is authoritative.

```powershell
npm ci
npm run dev
npm test
npm run test:desktop
npm run dist:win
```

`npm run dev` starts Electron with a local Vite renderer. `npm run build` typechecks and bundles without packaging. `npm run pack:win` produces an unpacked Windows distribution. `npm run dist:win` produces the x64 NSIS installer. Icons are committed assets; regenerate them with [scripts/create-icon.ps1](scripts/create-icon.ps1).

The desktop test uses temporary user data and an isolated mocked ADO transport. It exercises source credential encryption, manual finding persistence, inline-comment payloads, duplicate protection, sample mode, edit/dismiss/restore, line jumps, search, shortcuts, and responsive layouts. It also checks the actual bundled Copilot runtime's signed-in-user status without invoking a model. Test screenshots are written under the machine temp directory for inspection and should be removed after inspection.

To test the packaged executable:

```powershell
$env:PRISM_EXECUTABLE = (Resolve-Path .\release\win-unpacked\Prism.exe).Path
try { node tests/desktop.smoke.mjs }
finally { Remove-Item Env:\PRISM_EXECUTABLE }
```

No live ADO reads/posts, live model review, or fresh interactive sign-in was performed during initial validation. Perform those acceptance checks against an authorized test PR before relying on Prism for regular review work.

## Repository and Brain

Application source belongs in `D:\Prism`. Persistent project knowledge, instructions, and session journals belong in the separate `b-prism` project brain. No remote repository is configured, and no commits or pushes are performed by setup.