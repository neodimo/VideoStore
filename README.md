# VideoStore — local-first prototype

VideoStore is a separate desktop product for inspecting and choosing among video files. The working slice is **local library → track inspection → quality picker → open in default player**. It also has Cinemeta catalog browsing and provider-account authentication scaffolding. It is not yet a Stremio/Torrentio streaming or debrid-download client.

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
- The Providers screen tests Real-Debrid or TorBox account tokens against their official account endpoints. After success it stores tokens encrypted with Electron's OS-backed `safeStorage`; if only Linux `basic_text` storage is available, saving is refused. No tokens or video data are packaged. **No real account has been tested yet**, and listing, streaming, and download actions are not connected.
- The Storage screen registers existing Plex movie/TV folders without writing to them. It queries the host OS for total/free space and previews a proposed file's post-placement space against a per-folder floor. Default floor is max(10% of drive capacity, 500 GiB). Unknown file size cannot receive a safe placement recommendation. Actual download/move is not wired yet.
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

Next vertical increments: account-library candidate listing verified with a real Real-Debrid/TorBox account; metadata matching of local/provider files with retained IDs/provenance and explicit ambiguity handling; capability profile and player selection; deliberate remote stream/download with progress, cancellation, retries, free-space checks and file selection. None of those are claimed implemented or account-tested yet.

## Verification

`npm test` covers title/episode/edition parsing, `ffprobe` precedence over filename claims, bitrate provenance, grouped-version rendering, filename HTML escaping, catalog normalization and resource paths, provider token transport, safe folder traversal, and storage floors. Live Cinemeta search and series metadata calls succeeded on 2026-10-04. A Windows portable package and a native Windows NSIS installer were built on the paired Windows side. The packaged app's real UI, preload bridge, and live catalog were verified through Chromium DevTools. WSL cannot cross-build NSIS here because Wine is absent. Linux GUI launch, account-backed downloads, and actual HDR/Atmos playback remain unverified.
