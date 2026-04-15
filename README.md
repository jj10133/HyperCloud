# HyperCloud

**HyperCloud** is a serverless, encrypted peer-to-peer file sync tool for macOS. Think iCloud — but without the cloud. Your files sync directly between your devices with no servers, no accounts, and no middlemen.

Built on the [Holepunch](https://holepunch.to) stack using [Hyperswarm](https://github.com/holepunchto/hyperswarm) for peer discovery and NAT traversal, and [BareKit](https://github.com/holepunchto/bare-kit) for running JavaScript natively on macOS.

---

## How it works

HyperCloud organises files into **spaces** — named folders that sync between devices. Each space has a secret key. Share the key with another device and it joins the space. That's it. No accounts, no setup, no servers.

```
Device A                        Device B
~/HyperCloud/Work/  ←────────→  ~/HyperCloud/Work/
~/HyperCloud/Photos/ ←───────→  ~/HyperCloud/Photos/

         direct encrypted P2P connection
                (no server in the middle)
```

When you add, edit, or delete a file on one device, it syncs to all other devices in that space automatically.

---

## Features

- **Serverless** — peers connect directly via Hyperswarm DHT, no infrastructure required
- **Encrypted** — all connections use the Noise protocol, end-to-end
- **Multiple spaces** — organise different folders independently, each with its own key
- **Menu bar app** — lives quietly in your menu bar, always syncing in the background
- **Share via QR** — share a space key by scanning a QR code or copying the key string
- **Pause/resume** — pause sync on a space without leaving it
- **Watch-drive** — intelligent file watching that debounces rapid saves and compares content hashes to avoid unnecessary syncs

---

## Architecture

```
Swift (macOS menu bar UI)
  ↕  bare-rpc over BareKit IPC
JavaScript (Bare runtime)
  ↕  Protomux channels over Hyperswarm connections
Peers (other devices running HyperCloud)
```

The JavaScript layer handles all networking and file sync logic. Swift handles the UI and communicates with JS via [bare-rpc](https://github.com/holepunchto/bare-rpc-swift). Each space gets its own [Protomux](https://github.com/holepunchto/protomux) channel on the shared peer connection — spaces that aren't shared with a peer simply don't open a channel.

File sync uses a manifest/want protocol:

1. On connect — both sides exchange a manifest of their files (key + mtime + hash)
2. Each side requests files the other has that are newer or missing
3. On local change — [watch-drive](https://github.com/holepunchto/watch-drive) detects changes and pushes them to all connected peers
4. Loop prevention — incoming file writes are tracked by content hash; watch-drive skips them to avoid echo loops

---

## Building

### Prerequisites

- Xcode 15+
- Node.js 18+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`
- [GitHub CLI](https://cli.github.com) — `brew install gh`

### 1. Install dependencies

```bash
npm install
```

### 2. Download BareKit prebuild

```bash
gh release download --repo holepunchto/bare-kit <version>
```

Unpack `prebuilds.zip` and move `macos/BareKit.xcframework` into `app/frameworks/`.

### 3. Generate Xcode project

```bash
xcodegen generate
```

### 4. Build and run

Open `HyperCloud.xcodeproj` in Xcode and hit Run, or use the Makefile:

```bash
make dev   # pack JS bundle
make gen   # regenerate Xcode project
```

### Addons

Native addons are linked into `app/addons/` as part of the build. After installing a new addon, add it to `app/addons/addons.yml` and regenerate:

```bash
xcodegen generate
```

---

## Usage

1. Launch HyperCloud — it appears in your menu bar
2. Create a space — give it a name, a `~/HyperCloud/<name>` folder is created automatically
3. Share the space key — tap the space in the menu → copy key or scan QR code
4. On the other device — join space, paste the key
5. Both devices now sync that folder automatically

---

## Stack

| Layer | Technology |
|-------|-----------|
| UI | SwiftUI — macOS menu bar app |
| Runtime | [BareKit](https://github.com/holepunchto/bare-kit) — JavaScript runtime for macOS |
| Networking | [Hyperswarm](https://github.com/holepunchto/hyperswarm) — DHT peer discovery + NAT traversal |
| Multiplexing | [Protomux](https://github.com/holepunchto/protomux) — multiple channels per connection |
| File watching | [watch-drive](https://github.com/holepunchto/watch-drive) — debounced, hash-aware file watcher |
| IPC | [bare-rpc](https://github.com/holepunchto/bare-rpc-swift) — Swift ↔ JS communication |
| Encryption | Noise protocol — built into Hyperswarm |

---

## License

GPL-3.0
