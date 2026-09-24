<p align="center">
  <img src="images/icon.png" width="160" alt="ABAP Mirror logo" />
</p>

<h1 align="center">ABAP Mirror</h1>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=abgunes.abap-mirror">
    <img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-blue?logo=visualstudiocode" alt="Install from VS Code Marketplace" />
  </a>
</p>

<p align="center">
  Lets <a href="https://claude.com/claude-code">Claude Code</a> read and edit ABAP objects opened through
  SAP's ABAP Development Tools (ADT) for VS Code. Every change stays safely under your review.
</p>

<p align="center">
  <img src="images/demo.gif" alt="ABAP Mirror demo: mirroring an open ADT object and syncing edits back" width="800" />
</p>

---

## Why this exists

The [ABAP Development Tools for VS Code extension](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode)
(`SAPSE.adt-vscode`) opens ABAP repository objects (programs, classes, CDS views, and more) under a virtual `abap://` URI scheme. The
object's source lives entirely in VS Code's in-memory document model, streamed live from the SAP system; it is
**never a real file on disk**.

That's a problem for AI coding assistants like Claude Code, which read and write through the real OS filesystem.
From Claude's point of view, an open `abap://` tab simply doesn't exist: it can't read the code you're looking at,
and it can't propose an edit to it.

**ABAP Mirror** closes that gap. It mirrors whatever ABAP object you have open to a real file on disk, keeps
it in sync in both directions, and gets out of the way otherwise. Claude Code (or any other tool that only
understands real files) can now work with the ABAP code you're actively looking at in ADT.

## Features

- **Automatic mirroring**: open any object in ADT and its source is written to a real file under
  `~/.abap-mirror/`, nested in a folder tree that matches the object's repository path.
- **Two-way live sync**: keep typing in the ADT tab and the mirror updates automatically; edit the mirror file
  (by hand, or by asking Claude Code to change it) and the change flows back into the ADT document buffer.
- **Opens once, then stays out of your way**: the mirror pane reveals itself automatically the first time you
  look at a given object. After that, switching tabs away and back won't keep stealing focus back to it.
- **Open it back up anytime**: right-click any ADT `abap://` document and choose **ABAP Mirror - Open
  Mirror Object**, or run the same command from the Command Palette.
- **ABAP-flavored syntax highlighting** in the mirror view: comments, strings (including `|string templates|`),
  numbers, keywords, operators, and punctuation are colored to match ADT's own conventions.
- **One-flag kill switch**: `abapMirror.enabled` turns the whole thing off instantly, no reload required.
- **Mirror a whole folder at once**: right-click any ABAP package (or other folder) in ADT's Explorer tree and choose **ABAP Mirror - Mirror Folder (with Sub-Objects)** to mirror every object under it, recursively, without opening an editor tab per object. Folders with more than 200 objects ask for confirmation first.
- **ABAP Mirror Files status view**: a new panel in the Explorer sidebar lists every mirrored object in the same hierarchy as ADT's own tree. An object shows red when its ADT document has unsaved changes pending, blue once it's saved. Folders containing an unsaved object expand automatically so you can spot it at a glance.
- **Type icons**: objects in the ABAP Mirror Files panel show a colored icon for their ABAP type (for example green for classes/interfaces, blue for CDS-related objects, purple for behavior definitions/service bindings, yellow for tables and other DDIC objects, brown for programs/function groups). An object with unsaved changes pending in ADT gets a red box around its icon. Fully customizable via **ABAP Mirror - Configure Type Icons**.

## How it works

1. You open (or switch focus to) an ABAP object in ADT.
2. The extension writes its current text to a mirror file under `~/.abap-mirror/`.
3. The mirror opens beside the original the first time, so Claude Code's active-file context picks up a real,
   readable file.
4. From then on, edits on either side are synced to the other automatically, so you don't need to keep both tabs focused.

## Safety model: nothing reaches SAP without your say-so

Syncing an edit back only updates the **in-memory buffer** of the ADT tab. It never calls `document.save()` and
never triggers ADT's activate/transport flow. You'll see the change land in the ADT editor with the normal
unsaved-changes indicator. Nothing reaches the SAP backend until you review it yourself and save/activate through
ADT as usual (`Ctrl+S`, or ADT's own Activate command).

If a mirror file changes while its original ADT document isn't open, the extension reopens that document
automatically (revealed beside your editor, not focused) and applies the change to its buffer, still without
ever calling save. This is how mirrored objects from **Mirror Folder** stay in sync even though most of them are
never opened by hand. If a change can't be synced back at all (the original object can no longer be resolved, for
example it was deleted from the package, or VS Code rejects the edit outright), you get an error notification with
a **Try Again** button instead of the edit silently vanishing. The affected object also shows an orange "!" badge
in the ABAP Mirror Files panel until the retry succeeds.

The optional MCP server (below) is the one exception, and it is off by default. When you turn it on, an MCP client
can ask VS Code to save and activate an object on SAP. Each such request pops up a confirmation in VS Code
first (with a diff of the change), unless you switch `abapMirror.mcp.confirmWrites` off.

## Getting started

1. Install [ABAP Mirror](https://marketplace.visualstudio.com/items?itemName=abgunes.abap-mirror)
   from the VS Code Marketplace, alongside `sapse.adt-vscode`.
2. Open any ABAP object through ADT as you normally would.
3. That's it: the mirror file appears automatically, and Claude Code can read/edit it like any other file in your
   workspace.

## Commands & context menu

| Command | What it does |
|---|---|
| **ABAP Mirror - Open Mirror Object** | Opens (or refocuses) the mirror file for the active ABAP document. Available via right-click in the editor, on the editor tab, or the Command Palette. |
| **ABAP Mirror - Mirror Folder (with Sub-Objects)** | Mirrors every object under the right-clicked ABAP package or folder, recursively, without opening editor tabs. Available via right-click on any `abap://` folder in the Explorer tree. |
| **ABAP Mirror - Configure Type Icons** | Opens a settings panel to customize the abbreviation and color shown for each ABAP object type in the ABAP Mirror Files panel. Available from the Command Palette or the panel's title-bar gear icon. |
| **ABAP Mirror - Retry Failed Syncs** | Lists every mirror that failed to sync back to ADT and lets you retry all of them, or a chosen few, in one go. Available from the Command Palette or the panel's title-bar sync icon. |
| **ABAP Mirror - Retry Sync** | Retries syncing a single object back to ADT. Shows up as a hover icon and right-click entry in the ABAP Mirror Files panel, only on an object that isn't fully synced. |
| **ABAP Mirror - Retry Sync for Folder** | Retries syncing every unsynced object under a folder back to ADT. Shows up as a hover icon and right-click entry in the ABAP Mirror Files panel, only on a folder containing something unsynced. |
| **ABAP Mirror - Copy MCP Client Config** | Copies a ready-to-paste MCP client configuration (with the token) for Cursor/Cline-style JSON, the Claude Code CLI, or VS Code `mcp.json`. |
| **ABAP Mirror - Regenerate MCP Token** | Creates a new MCP token; clients using the old one stop working until you copy the config again. |
| **ABAP Mirror - Rebuild MCP Object Index** | Crawls a connected system's prefix packages so MCP clients can search objects by name. Cancellable. |

<br/>

<p align="center">
  <img src="images/app_icons.png" alt="ABAP Mirror Files panel title bar: the gear icon opens Configure Type Icons, the sync icon opens Retry Failed Syncs" width="700" />
</p>

<br/>

The ABAP Mirror Files panel's title bar carries two icons, shown above: **1** is the gear, **ABAP Mirror - Configure Type Icons**. **2** is the sync icon, **ABAP Mirror - Retry Failed Syncs**.

## MCP server for other AI tools

ABAP Mirror can also run a small local [MCP](https://modelcontextprotocol.io) server named `abap-mirror`. It
lets any MCP client (Cursor, GitHub Copilot, Cline, Claude Code, ...) work with ABAP objects on the systems you
are connected to through SAP ADT in VS Code. It uses ADT's existing connection and login; abap-mirror stores no
SAP credentials of its own. It is independent of the mirror files.

**Not an alternative to SAP's own ADT MCP tooling, use both together:** SAP's ADT tools that ship for AI agents are
only reachable from inside VS Code, through GitHub Copilot. abap-mirror exists to bring that same kind of ABAP
access (list, search, read, write, activate, lock, ...) to every other MCP client too, Cursor, Claude Code, Cline
and the rest, including tools SAP's own integration does not directly support. It does not replace SAP's ADT
tooling; run the two side by side, and use whichever fits the client you're in.

**Turn it on:** set `abapMirror.mcp.enabled` to `true`. An `abap-mirror MCP :2240` item appears in the status bar.

<br/>

<p align="center">
  <img src="images/mcp_configuration.png" alt="VS Code Settings: the ABAP Mirror > Mcp: Enabled checkbox, highlighted, with its description of what the MCP server lets external AI tools do" width="800" />
</p>

<br/>

**Connect a client:** run **ABAP Mirror - Copy MCP Client Config** (or click the status bar item), pick your
client's format, and paste it into that client's MCP configuration. The snippet contains a secret token, so treat
it like a password.

<br/>

<p align="center">
  <img src="images/mcp_activate.png" alt="Copy abap-mirror MCP client config quick pick, with the client format options (mcpServers JSON, Claude Code CLI command, VS Code mcp.json)" width="700" />
</p>

<br/>

**1** is the `abap-mirror MCP :2240` status bar item; clicking it opens the same picker as the command. **2** is
one of the client formats, here **mcpServers JSON** for Cursor, Cline, Windsurf and most other clients.

Once a client has the config, it can list the server's tools. In Claude Code, for example, `/mcp` shows
`abap-mirror` as `Connected` with every tool below: `read-only` ones never change anything in SAP,
`destructive` ones write source, and `abap_activate`/`abap_lock` carry neither tag because they change state in
SAP without touching an object's source. `abap_unlock` is tagged `destructive` since the screenshot below was
taken, because ADT's own unlock command discards unsaved changes (abap-mirror refuses it in that case, see below).

<br/>

<p align="center">
  <img src="images/mcp_tools.png" alt="Claude Code's /mcp panel: abap-mirror listed as Connected, with its tools each tagged read-only, destructive, or untagged for abap_activate/abap_lock/abap_unlock" width="500" />
</p>

<br/>

| Tool | What it does |
|---|---|
| `abap_list_systems` | Lists the SAP systems connected in VS Code. |
| `abap_list_folder` | Lists a package or folder in the ADT repository tree. |
| `abap_search_objects` | Finds objects by name (wildcards allowed), from a local index or through ADT's Open Object dialog. |
| `abap_refresh_index` | Rebuilds the local name index for a system (all prefix packages, or given packages). |
| `abap_read_object` | Reads an object's source, every part (for classes: definitions, implementations, test classes, ...). |
| `abap_where_used` | Lists where an object is used. |
| `abap_check` | Runs SAP's syntax check (ADT's "Check Object") on an object and returns its diagnostics, without activating it. Read-only; no confirmation needed. |
| `abap_write_source` | Saves new source for one part, optionally activating it. Rejects the write if the source changed since it was read. |
| `abap_edit_source` | Like `abap_write_source`, but takes one or more exact-text replacements instead of the whole part, cheaper for a small change to a large part. |
| `abap_activate` | Activates up to 20 objects. Checks each one first (ADT's "Check Object"); an object with errors is left un-activated and its diagnostics are returned instead of a popup. |
| `abap_lock` / `abap_unlock` | Locks or unlocks an object for editing. |

Good to know:

- VS Code must be running with the ADT connection open; the server only listens on `127.0.0.1` and every request
  needs the token. **ABAP Mirror - Regenerate MCP Token** invalidates the old token.
- Checking, saving, activating, locking and unlocking run one at a time and briefly show the object in an editor
  tab, because ADT performs these on the active editor. If SAP asks for a transport request, pick it in VS Code.
- An object with unsaved changes in VS Code is never overwritten: save or revert it first.
- Activate, lock and unlock are refused while any editor of the same object (for example a class's local types
  tab) has unsaved changes, before you are asked to confirm. ADT's own commands would otherwise act on those
  changes without review: activate saves them to SAP first, unlock discards them, and lock refuses without saying
  why. Saving with `abap_write_source`/`abap_edit_source` is not affected unless `activate` is set.
- If a save fails (for example another user holds the lock), the tool error quotes SAP's exact reason
  ("SAP says: ..."). abap-mirror reads it from the ADT extension's own log file
  (`SAPSE.adt-vscode/adtWorkspace/.metadata/.log` in VS Code's workspace storage), because VS Code does not let
  one extension read another's notifications. When that log has nothing, the error points you to VS Code's
  Notifications (the bell icon) instead.
- Lock and unlock report `locked`/`unlocked`, or fail with the HTTP status SAP answered (for example 403 when
  another session is editing the object). abap-mirror reads it from ADT's HTTP log
  (`SAPSE.adt-vscode/ADT Communication Log.log` in VS Code's logs folder), which ADT always writes; no setup is
  needed. Only a call for the same object counts, so a lock you run on another object at the same moment is not
  mistaken for it. `unknown` means ADT made no call to SAP, for example because the object was already locked.
- ADT does not log SAP's wording for a refused lock. If you want it in the error too ("SAP says: User ... is
  currently editing ..."), turn on ADT's language client tracing: add
  `"adtLanguageClient.trace.server": "verbose"` to your user settings, then in the Output panel pick
  **ADT Error Log**, click the gear icon, choose **Set Log Level** and pick **Trace**. Verbose tracing writes
  everything ADT exchanges with SAP to that log, including source code, so this is optional.
- The Claude Code CLI snippet puts the token on the command line, so it can end up in that shell's history.
  Prefer the JSON snippets if that is a concern.
- Name search uses an index of the packages matching `abapMirror.mcp.indexedPackagePrefixes` (default `Z`, `Y`).
  Build it with **ABAP Mirror - Rebuild MCP Object Index**. Anything else is found through ADT's Open Object
  dialog, which asks you to pick the object in VS Code.
- The index (object names and repository paths only, no source code) is stored in VS Code's global storage for
  this extension.

## Settings

| Setting | Default | Description |
|---|---|---|
| `abapMirror.enabled` | `true` | Turn mirroring on or off. Takes effect immediately, no reload needed. When off, no mirror files are created/updated and nothing is synced back into `abap://` documents; existing mirror files are left untouched. |
| `abapMirror.icons.enableInMirrorPanel` | `true` | Show a colored icon for each object's ABAP type in the ABAP Mirror Files panel. Turn off to fall back to plain file icons. |
| `abapMirror.mcp.enabled` | `false` | Run the local `abap-mirror` MCP server for other AI tools. See "MCP server for other AI tools". |
| `abapMirror.mcp.port` | `2240` | Port on `127.0.0.1` for the MCP server. |
| `abapMirror.mcp.confirmWrites` | `true` | Ask in VS Code before an MCP client saves, activates, locks or unlocks an object. |
| `abapMirror.mcp.indexedPackagePrefixes` | `["Z", "Y"]` | Package prefixes crawled when the MCP object index is rebuilt. |

`abapMirror.mcp.enabled`, `abapMirror.mcp.port` and `abapMirror.mcp.confirmWrites` are user-level (application scope)
settings only, so a workspace or `.code-workspace` settings file cannot change them.

## Where mirror files live

`~/.abap-mirror/`: one file per ABAP object, nested in folders that match its repository path (so paths stay unique), with a short, readable leaf filename, e.g. `zdemo.prog.abap.abapmirror`. Mirror editor tabs carry an M badge (colored by sync state) so they are never confused with the real ADT tab. Safe to delete at any time: it's regenerated the next time you open the corresponding object.

## Data and privacy

Mirror files live under `~/.abap-mirror/`, in your home directory and outside any workspace. That is deliberate, it is what lets filesystem-based assistants read them, but it means your proprietary ABAP source is written to plain files that home-directory backups, cloud sync (OneDrive, iCloud, Dropbox), and desktop search or indexing services can pick up. Treat that directory as you would any local copy of SAP source:

- Keep it inside your normal secured user profile, and exclude it from backup or sync tools if your organization requires it.
- Do not commit or upload mirrored source without review; the `.abapmirror` files are a live copy of what you opened in ADT.
- The whole directory is safe to delete at any time; each object's mirror is regenerated the next time you open it.

## Known limitations

- Only `abap://` documents are mirrored.
- A brand-new object needs to be focused at least once before its mirror file exists.
- No conflict resolution: if you edit both the ADT tab and the mirror file at the exact same moment, whichever
  write lands last wins.
- The bundled grammar is a close approximation of ADT's own ABAP highlighting rather than a byte-for-byte copy, so
  colors can differ slightly depending on your theme.
- Mirroring a folder is a snapshot: objects added to that package afterward won't appear until you run
  **Mirror Folder** again.
- The mirror status view's red/blue coloring is provided through VS Code's file decoration API, which is
  per-file rather than per-view, so the same coloring may also show up on a mirrored file elsewhere in VS Code
  (for example, an open editor tab), not only inside the ABAP Mirror Files panel.
- Type icons are best-effort: the object type is inferred from the dotted suffix on the mirror's own filename (e.g. `.clas.abap`, `.ddls.acds`), which covers the common ADT object types but has not been exhaustively verified against every one that exists. An unrecognized type falls back to a plain gray "?" icon rather than a wrong one.
- If syncing a change back fails, retrying (via the error notification's **Try Again** button) re-sends the mirror's current on-disk content; it does not re-check whether the ADT document itself changed in the meantime.

## Release notes

### 0.2.2

- `abap_activate`, `abap_lock`, `abap_unlock` and `abap_write_source`/`abap_edit_source` with `activate` are
  refused while any editor of the same object has unsaved changes. ADT's own commands would otherwise save those
  changes to SAP without review (activate) or discard them (unlock).
- `abap_unlock` is now tagged `destructive`.
- Lock and unlock status only counts ADT's HTTP call for the requested object, not any lock on the same system.

### 0.2.1

- Documents the MCP server with screenshots (enabling `abapMirror.mcp.enabled`, the **Copy MCP Client Config** picker, and a connected client's tool list) and clarifies that `abap-mirror` complements rather than replaces SAP's own ADT MCP tooling.

### 0.2.0

- New optional **MCP server** (`abap-mirror`): lets MCP clients such as Cursor, GitHub Copilot, Cline and Claude
  Code list, search, read, check, find where-used, write or edit, activate, lock and unlock ABAP objects through
  your SAP ADT connection in VS Code. Off by default; enable it with `abapMirror.mcp.enabled`.
- Every save, activation, lock and unlock from an MCP client asks for confirmation in VS Code (a diff is shown
  for saves only), unless `abapMirror.mcp.confirmWrites` is off, in which case nothing asks for confirmation.
- A failed save, lock or unlock quotes SAP's own reason (for example another user holding the lock), read from
  the ADT extension's own log files, and `abap_lock`/`abap_unlock` report a real `locked`/`unlocked` status
  instead of a generic failure.
- `abap_edit_source` applies exact-text replacements instead of resending a whole source part, and `abap_check`
  runs SAP's syntax check and returns its diagnostics without activating.
- Requires VS Code 1.82 or newer.

### 0.1.1

- **Type icons** in the ABAP Mirror Files panel: a colored icon per ABAP object type (class, CDS view, table, program, and more), fully customizable via the new **ABAP Mirror - Configure Type Icons** command. An object with unsaved changes pending in ADT gets a red box around its icon.
- The **Configure Type Icons** settings panel now has a modern, VS Code-themed look, a **Copy** button per row (for quickly cloning a type's color/abbreviation into a new row), and reliably saves your changes (a missing content-security-policy previously made every button in the panel silently do nothing).
- Object type detection is more accurate: it now reads the real ABAP object type suffix embedded in the mirror's own filename, instead of guessing from surrounding folder names. This fixed several object types (CDS views among them) showing the wrong icon or no icon at all.
- Fixed type icons intermittently disappearing after changing a color and scrolling the panel: the tree view now assigns each row a stable identity so VS Code reliably repaints it, and a settings save no longer wipes the entire icon cache (which could delete a still-valid icon file for an unrelated, unchanged object type).
- Sync-back failures (a rejected edit, or an ADT document that can no longer be reopened) now show an error notification with a **Try Again** action and an orange "!" badge in the ABAP Mirror Files panel, instead of failing silently.
- New **ABAP Mirror - Retry Failed Syncs** command: lists every mirror currently failing to sync back to ADT and lets you retry all of them, or a chosen few, at once.
- Unsynced objects and folders in the ABAP Mirror Files panel now show a right-click (and hover-icon) **Retry Sync** action, for retrying just that one object or a whole folder's worth of unsynced objects.

### 0.1.0

First release as **ABAP Mirror**, the successor to
[ABAP Claude Mirror](https://marketplace.visualstudio.com/items?itemName=abgunes.abap-claude-mirror).
Everything from the previous extension plus:

- **Mirror Folder (with Sub-Objects)** command: right-click any ABAP package or folder in ADT's Explorer
  tree to mirror everything under it, recursively, without opening an editor tab per object. Folders with
  more than 200 objects ask for confirmation first, and the run is cancellable.
- **ABAP Mirror Files** panel in the Explorer sidebar: every mirrored object in its original hierarchy,
  red while its ADT document has unsaved changes, blue once saved. Folders holding an unsaved object
  expand automatically.
- Editing a mirror file whose original ADT document is not open now reopens that document automatically
  and applies the change to its buffer. Nothing is ever saved to SAP without you.
- Objects that fail during bulk mirroring are listed in the "ABAP Mirror" output channel instead of
  failing silently.
- Cleaner mirror filenames: no more name prefix. Mirror tabs are marked with an M badge instead.
- Codebase converted to TypeScript.

## Contributing

Issues and pull requests are welcome. See the [project's GitHub page](https://github.com/abgunes/ABAP-Mirror)
for details.

## License

MIT
