# VideoStore — local-first prototype

VideoStore is a separate desktop product for inspecting local video files and placing user-authorized downloads in an existing Plex library. The current preview supports **local library → quality picker → OS player**, live Cinemeta browsing, and a host-only Real-Debrid **existing account downloads → cart → drive/folder preview → staged download** path. It does not discover new sources through Stremio/Torrentio or list TorBox files yet.

## Run

Requirements: Node.js 22.12+, a supported Windows or Linux desktop, and (recommended) `ffprobe` on `PATH` from FFmpeg. `ffprobe` is optional: without it, the app labels filename-derived data as a claim and does not show track-level facts.

```bash
npm ci
npm start
```

Use **Add videos** to select individual files or **Scan folder** to index an existing tree without moving anything. Folder scans can be cancelled; they skip symlinks and defer `ffprobe` so a large Plex library is not probed file-by-file in one blocking pass. The app stores file paths and inspection data in Electron's local user-data directory; it does not copy video files. **Remove entry** removes only the catalog entry. **Open in default player** delegates playback to the OS player, so HDR and audio passthrough depend on that player, the OS, and connected hardware. No playback-capability claim is inferred from a filename.

## Current scope and honesty rules

- Movie and TV episode filename parsing, with seasons/episodes and edition tags. Multiple files for the same parsed title/episode appear as versions in one quality picker.
- `ffprobe` track inspection records actual resolution, video codec, audio tracks, subtitles, transfer metadata, and a Dolby Vision profile **only when present in probe data**. Bitrate is either container-reported or clearly estimated from size and duration.
- HDR/Atmos terms from filenames are claims. Atmos is **never shown as verified** by this slice. Metadata that cannot be inspected stays unknown.
- Local watchlist and watched flags. The quality score is a rough, explainable ordering aid, **not** tailored to the user's actual display, receiver, or player yet. Manual selection remains available.
- Discover searches the live official Stremio Cinemeta add-on for real IMDb-identified films and series, including multi-episode details, synopsis, cast, genres, and posters. Art is loaded on demand, not bundled. Search terms are sent to Cinemeta; local file names are not automatically sent.
- The Providers screen tests Real-Debrid or TorBox account tokens against their official account endpoints. After success it stores tokens encrypted with Electron's OS-backed `safeStorage`; if only Linux `basic_text` storage is available, saving is refused. No tokens or video data are packaged. **No real account has been tested yet.** The **Account files** view lists up to 100 existing Real-Debrid downloads; filenames provide tentative quality claims, not probed track facts. TorBox file listing, Torrentio/Stremio source discovery, and new debrid unrestrict flows are not connected.
- The Storage screen registers existing Plex movie/TV folders. It reads drive free space and infers a bounded sample of existing folder conventions; ambiguous layouts require explicit user selection. A cart previews each exact-size file path and post-download free space against a per-drive floor. Default floor is max(10% of drive capacity, 500 GiB); folders on the same physical volume share one budget. Unknown sizes, path collisions, and floor violations block placement. On submission, the host fetches directly from its account link into a staging file on the target drive, then renames a complete file into the Plex folder. Interrupted/failed partials are cleaned up; interrupted jobs are recorded but **resume is not implemented**. No existing media is moved or deleted.
- Posters use a consistent 2:3 portrait frame. An optional [RatingPosterDB](https://rpdb.apidoc.io/) key is stored encrypted on the host; poster overrides are fetched and cached there, while the laptop receives only image bytes. Missing overrides fall back to Cinemeta. No key has been tested live yet.
- The optional Network page starts a browser client for a laptop on a trusted private LAN. Pairing is by short-lived host-displayed code and an HttpOnly session cookie. The laptop sends only title/search/cart commands; provider credentials, generated links, staging, downloads, and media files stay on the host. **This is HTTP, not TLS**: do not port-forward or use on an untrusted network. Keep the host app running. The Windows-local route/pairing was smoke-tested, but connectivity from the user's laptop and Windows firewall configuration remain unverified.
- The header update control follows GameStore's explicit check → download/progress → restart flow. It is inactive in development builds and labels Linux `.deb` installs unsupported for in-app updates. Release metadata is produced by the packaging workflow; end-to-end updating remains unverified until a later release is installed over this one.

## Discovery and integration direction

Existing options checked: [Stremio](https://www.stremio.com/), [Kodi](https://kodi.tv/about/), [Jellyfin](https://jellyfin.org/), and [Debrid Media Manager](https://github.com/debridmediamanager/debrid-media-manager). They cover meaningful pieces of streaming, local playback, and debrid library management. VideoStore is only justified if its provenance-aware version picker and hardware-aware ranking deliver a genuinely distinct workflow; otherwise integrate with those tools rather than duplicating them.

GameStore's [public repository](https://github.com/neodimo/GameStore) was inspected for product patterns. VideoStore mirrors its user-controlled updater states and release metadata approach, media-light gate, and truthful unsupported states, without copying game-specific catalogs or download assumptions.

Primary integration references:

- [Real-Debrid API](https://api.real-debrid.com/) documents user torrents, torrent details, unrestricting links, and device authorization. Do not assume instant availability from old integrations; verify endpoints and account behavior.
- [TorBox API](https://api.torbox.app/docs) exposes `mylist`, `checkcached`, and `requestdl`. GameStore's TorBox collection flow was not account-proven and is not evidence for VideoStore.
- [Stremio add-on protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html) defines `catalog`, `meta`, `stream`, and subtitle resources. Torrentio can be assessed as a user-configured add-on, with its own uptime, configuration, and rights constraints; VideoStore does not scrape or impersonate it.
- [TMDB search/discover documentation](https://developer.themoviedb.org/docs/finding-data) is a candidate for posters, descriptions, and stable IDs; an API key and attribution terms need to be handled before implementation.
- [FFprobe documentation](https://ffmpeg.org/ffprobe-all.html) documents stream and format inspection. [mpv manual](https://mpv.io/manual/stable/) is a candidate for deliberate external-player handoff, subject to real hardware testing.

Next increments: live Real-Debrid account and real laptop-to-host acceptance; TorBox candidate/download adapter; source discovery and metadata matching with retained IDs/provenance; capability-aware ranking, player selection, and HDR/Atmos hardware proof. No existing-media move, automatic source acquisition, stream handoff, or interrupted-transfer resume is claimed.

## Verification

`npm test` covers parsing and ffprobe provenance, Cinemeta, provider-token transport, poster fetching, LAN pairing/session rules, cart placement, host-side download completion/failure, and storage floors. Live Cinemeta search and series metadata calls succeeded on 2026-10-04. A native Windows NSIS installer was built and its packaged GUI, 2:3 poster cards, LAN host, pairing, and authenticated browser route were smoke-tested on the Windows machine. No account-backed download, actual laptop connection, Plex-drive write, Linux GUI launch, or HDR/Atmos playback has been verified.
