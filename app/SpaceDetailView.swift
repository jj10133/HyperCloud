import SwiftUI
import CoreImage.CIFilterBuiltins

struct SpaceDetailView: View {
    @EnvironmentObject var worker: Worker
    @Binding var route: MenuBarView.Route

    let space: Space

    @State private var key: String? = nil
    @State private var copied = false
    @State private var showDeleteConfirm = false

    var body: some View {
        VStack(spacing: 0) {

            // ── Nav bar ───────────────────────────────────────────────────────
            HStack {
                Button(action: { route = .spaces }) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("Back")
                    }
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)

                Spacer()

                Text(space.name)
                    .font(.headline)

                Spacer()

                // balance the back button
                Text("Back").opacity(0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            ScrollView {
                VStack(spacing: 20) {

                    // ── QR code ──────────────────────────────────────────────
                    Group {
                        if let key {
                            VStack(spacing: 12) {
                                if let img = qrImage(for: "drift://join/\(key)") {
                                    Image(nsImage: img)
                                        .interpolation(.none)
                                        .resizable()
                                        .scaledToFit()
                                        .frame(width: 148, height: 148)
                                        .cornerRadius(10)
                                        .padding(6)
                                        .background(Color.white)
                                        .cornerRadius(12)
                                }

                                // copy row
                                HStack(spacing: 8) {
                                    Text(shortKey(key))
                                        .font(.system(.caption, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)

                                    Spacer()

                                    Button(copied ? "Copied!" : "Copy ID") {
                                        NSPasteboard.general.clearContents()
                                        NSPasteboard.general.setString(key, forType: .string)
                                        copied = true
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                            copied = false
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                        } else {
                            ProgressView()
                                .padding(.vertical, 32)
                        }
                    }

                    Divider()

                    // ── Peer status ───────────────────────────────────────────
                    HStack(spacing: 6) {
                        Circle()
                            .fill(space.peers > 0 ? Color.green : Color.secondary)
                            .frame(width: 7, height: 7)
                        Text(space.peers == 0
                             ? "No peers connected"
                             : "\(space.peers) peer\(space.peers == 1 ? "" : "s") connected")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }

                    // ── Actions ───────────────────────────────────────────────
                    VStack(spacing: 8) {
                        Button {
                            worker.openFolder(id: space.id)
                        } label: {
                            Label("Open Folder", systemImage: "folder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)

                        Button {
                            space.paused
                                ? worker.resumeSpace(id: space.id)
                                : worker.pauseSpace(id: space.id)
                        } label: {
                            Label(
                                space.paused ? "Resume Sync" : "Pause Sync",
                                systemImage: space.paused ? "play" : "pause"
                            )
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.regular)

                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            Label("Delete Space", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.regular)
                    }
                }
                .padding(16)
            }
        }
        .task {
            key = await worker.getSpaceKey(id: space.id)
        }
        .confirmationDialog(
            "Delete \"\(space.name)\"?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                worker.deleteSpace(id: space.id)
                route = .spaces
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The local folder will remain but syncing will stop.")
        }
    }

    // ── QR helpers ────────────────────────────────────────────────────────────

    private func qrImage(for string: String) -> NSImage? {
        let context = CIContext()
        let filter  = CIFilter.qrCodeGenerator()
        filter.message          = Data(string.utf8)
        filter.correctionLevel  = "M"
        guard let output = filter.outputImage,
              let cgImg  = context.createCGImage(output, from: output.extent)
        else { return nil }
        return NSImage(cgImage: cgImg, size: NSSize(width: 148, height: 148))
    }

    private func shortKey(_ key: String) -> String {
        guard key.count > 16 else { return key }
        return "\(key.prefix(8))…\(key.suffix(8))"
    }
}
