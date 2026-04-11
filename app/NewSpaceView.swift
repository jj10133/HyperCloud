import SwiftUI

struct NewSpaceView: View {
    @EnvironmentObject var worker: Worker
    @Binding var route: MenuBarView.Route

    @State private var mode: Mode = .create
    @State private var name = ""
    @State private var key  = ""

    enum Mode: String, CaseIterable {
        case create = "Create"
        case join   = "Join"
    }

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

                Text("New Space")
                    .font(.headline)

                Spacer()

                Button("Done") { submit() }
                    .buttonStyle(.plain)
                    .foregroundStyle(canSubmit ? Color.accentColor : Color.secondary)
                    .disabled(!canSubmit)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            VStack(spacing: 16) {

                // ── Mode picker ──────────────────────────────────────────────
                Picker("", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { m in
                        Text(m.rawValue).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                // ── Name ─────────────────────────────────────────────────────
                VStack(alignment: .leading, spacing: 4) {
                    Text("Name")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField(
                        mode == .create ? "e.g. personal, work, photos" : "e.g. shared-docs",
                        text: $name
                    )
                    .textFieldStyle(.roundedBorder)
                }

                // ── Key (join only) ───────────────────────────────────────────
                if mode == .join {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Space ID")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Paste ID from another device", text: $key)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.caption, design: .monospaced))
                    }
                }

                // ── Hint ──────────────────────────────────────────────────────
                Group {
                    if mode == .create {
                        Text("Creates ~/Drift/\(name.isEmpty ? "…" : name)/")
                    } else {
                        Text("Joins the space and syncs files from connected peers.")
                    }
                }
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .leading)

                // ── Submit ────────────────────────────────────────────────────
                Button(mode == .create ? "Create Space" : "Join Space") {
                    submit()
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
                .disabled(!canSubmit)
            }
            .padding(16)
        }
    }

    private var canSubmit: Bool {
        let n = name.trimmingCharacters(in: .whitespaces)
        if n.isEmpty { return false }
        if mode == .join && key.trimmingCharacters(in: .whitespaces).isEmpty { return false }
        return true
    }

    private func submit() {
        guard canSubmit else { return }
        let n = name.trimmingCharacters(in: .whitespaces)
        if mode == .create {
            worker.createSpace(name: n)
        } else {
            worker.joinSpace(name: n, key: key.trimmingCharacters(in: .whitespaces))
        }
        route = .spaces
    }
}
